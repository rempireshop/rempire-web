/**
 * REMPIRE prototype feedback widget.
 *
 * Self-contained vanilla JS, injected into static prototype pages via a
 * <script> tag. Floating 💬 button bottom-left opens a comment panel;
 * comments POST to /api/feedback/ (trailing slash — next.config uses
 * trailingSlash:true) and land in Telegram/email/Blob.
 *
 * No dependencies, no external CSS — everything lives under one
 * div#rempire-feedback root. Idempotent (guards on window.__rempireFeedback).
 */
(function () {
  "use strict";
  if (window.__rempireFeedback) return;
  window.__rempireFeedback = true;

  var INK = "#1c1a00";
  var PAPER = "#fdfcf9";
  var RED = "#8c1a0f";
  var FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  function make(tag, css) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    return n;
  }

  function squish(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function init() {
    var old = document.getElementById("rempire-feedback");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var root = make("div");
    root.id = "rempire-feedback";

    // ---------- state ----------
    var mood = null; // 'good' | 'bad' | 'change' | null
    var picked = null; // { label, snippet, path } | null
    var sending = false;
    var picking = false;

    // ---------- floating button ----------
    var fab = make(
      "button",
      "position:fixed;right: 14px;bottom:14px;z-index:99999;" +
        "width:52px;height:52px;border-radius:50%;border:none;" +
        "background:" + INK + ";color:" + PAPER + ";" +
        "display:flex;align-items:center;justify-content:center;" +
        "font-size:22px;line-height:1;cursor:pointer;padding:0;margin:0;" +
        "box-shadow:0 6px 20px rgba(28,26,0,.35);",
    );
    fab.type = "button";
    fab.title = "Оставить комментарий";
    fab.setAttribute("aria-label", "Оставить комментарий");
    fab.textContent = "💬";

    // ---------- panel ----------
    var panel = make(
      "div",
      "position:fixed;right: 14px;bottom:78px;z-index:99999;" +
        "width:min(340px, calc(100vw - 28px));box-sizing:border-box;" +
        "background:" + PAPER + ";border:1px solid " + INK + ";" +
        "padding:16px;color:" + INK + ";font-family:" + FONT + ";" +
        "display:none;",
    );

    var formWrap = make("div");

    // header: title + close
    var header = make(
      "div",
      "display:flex;align-items:center;justify-content:space-between;",
    );
    var title = make(
      "div",
      "font-weight:700;font-size:14px;text-transform:uppercase;" +
        "letter-spacing:.1em;",
    );
    title.textContent = "Комментарий";
    var closeBtn = make(
      "button",
      "border:none;background:transparent;color:" + INK + ";" +
        "font-size:16px;line-height:1;cursor:pointer;padding:4px;margin:0;",
    );
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Закрыть");
    closeBtn.textContent = "✕";
    header.appendChild(title);
    header.appendChild(closeBtn);

    // mood chips
    var chipRow = make(
      "div",
      "display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;",
    );
    var CHIP_CSS =
      "border:1px solid " + INK + ";background:transparent;color:" + INK +
      ";font-family:inherit;font-size:13px;padding:6px 10px;cursor:pointer;" +
      "margin:0;";
    var chips = [];
    [
      ["good", "Нравится"],
      ["bad", "Не нравится"],
      ["change", "Изменить"],
    ].forEach(function (m) {
      var chip = make("button", CHIP_CSS);
      chip.type = "button";
      chip.textContent = m[1];
      chip.__mood = m[0];
      chip.addEventListener("click", function () {
        mood = mood === m[0] ? null : m[0]; // single-select, optional
        paintChips();
      });
      chips.push(chip);
      chipRow.appendChild(chip);
    });
    function paintChips() {
      chips.forEach(function (chip) {
        var on = chip.__mood === mood;
        chip.style.background = on ? INK : "transparent";
        chip.style.color = on ? PAPER : INK;
      });
    }

    // pick-a-place button
    var pickBtn = make(
      "button",
      "margin-top:10px;width:100%;box-sizing:border-box;" +
        "border:1px solid " + INK + ";background:transparent;color:" + INK +
        ";font-family:inherit;font-size:13px;padding:8px;cursor:pointer;",
    );
    pickBtn.type = "button";
    pickBtn.textContent = "Указать место на странице";

    // picked-place row
    var pickedRow = make(
      "div",
      "display:none;margin-top:8px;font-size:12px;" +
        "align-items:center;gap:6px;",
    );
    var pickedText = make(
      "span",
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;",
    );
    var pickedClear = make(
      "button",
      "border:none;background:transparent;color:" + INK + ";" +
        "font-size:13px;line-height:1;cursor:pointer;padding:2px;margin:0;",
    );
    pickedClear.type = "button";
    pickedClear.setAttribute("aria-label", "Убрать место");
    pickedClear.textContent = "✕";
    pickedRow.appendChild(pickedText);
    pickedRow.appendChild(pickedClear);
    function paintPicked() {
      if (picked) {
        pickedText.textContent =
          "Место: " + (picked.label || picked.path || "выбранный элемент");
        pickedRow.style.display = "flex";
      } else {
        pickedRow.style.display = "none";
      }
    }
    pickedClear.addEventListener("click", function () {
      picked = null;
      paintPicked();
    });

    // textarea
    var textarea = make(
      "textarea",
      "margin-top:10px;width:100%;box-sizing:border-box;min-height:84px;" +
        "border:1px solid " + INK + ";background:transparent;color:" + INK +
        ";font-family:inherit;font-size:14px;padding:8px;resize:vertical;",
    );
    textarea.placeholder = "Что думаешь? Можно коротко.";

    // error line
    var errLine = make(
      "div",
      "display:none;margin-top:8px;color:" + RED + ";font-size:12px;",
    );
    errLine.textContent = "Не отправилось — попробуй ещё раз";

    // send
    var sendBtn = make(
      "button",
      "margin-top:10px;width:100%;box-sizing:border-box;height:44px;" +
        "border:none;background:" + INK + ";color:" + PAPER + ";" +
        "font-family:inherit;font-size:14px;font-weight:700;" +
        "letter-spacing:.08em;cursor:pointer;",
    );
    sendBtn.type = "button";
    sendBtn.textContent = "ОТПРАВИТЬ";

    formWrap.appendChild(header);
    formWrap.appendChild(chipRow);
    formWrap.appendChild(pickBtn);
    formWrap.appendChild(pickedRow);
    formWrap.appendChild(textarea);
    formWrap.appendChild(errLine);
    formWrap.appendChild(sendBtn);

    // sent confirmation (swapped in on success)
    var sentMsg = make(
      "div",
      "display:none;font-size:14px;font-weight:700;text-align:center;" +
        "padding:18px 0;",
    );
    sentMsg.textContent = "Отправлено ✓ Спасибо!";

    panel.appendChild(formWrap);
    panel.appendChild(sentMsg);

    // ---------- pick mode ----------
    var overlay = make(
      "div",
      "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;" +
        "cursor:crosshair;background:transparent;display:none;",
    );

    function onPickKey(e) {
      if (e.key === "Escape" || e.keyCode === 27) endPick();
    }

    function startPick() {
      picking = true;
      panel.style.display = "none";
      overlay.style.display = "block";
      document.addEventListener("keydown", onPickKey, true);
    }

    function endPick() {
      picking = false;
      overlay.style.display = "none";
      document.removeEventListener("keydown", onPickKey, true);
      panel.style.display = "block";
      paintPicked();
    }

    function labelFor(el) {
      var t = "";
      try {
        var h = el.closest && el.closest("h1,h2,h3,h4,h5,h6");
        if (!h && el.querySelector) h = el.querySelector("h1,h2,h3,h4,h5,h6");
        if (h) t = squish(h.textContent);
        if (!t && el.getAttribute) t = squish(el.getAttribute("aria-label"));
        if (!t) t = squish(el.textContent);
      } catch (e) {
        /* ignore */
      }
      return t.slice(0, 60);
    }

    function pathFor(el) {
      var parts = [];
      try {
        var node = el;
        for (var i = 0; i < 4 && node && node.tagName; i++) {
          var part = node.tagName.toLowerCase();
          if (node.id) part += "#" + node.id;
          else if (node.classList && node.classList.length) {
            part += "." + node.classList[0];
          }
          parts.unshift(part);
          node = node.parentElement;
        }
      } catch (e) {
        /* ignore */
      }
      return parts.join(" > ");
    }

    overlay.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var target = null;
      try {
        var stack = document.elementsFromPoint(e.clientX, e.clientY) || [];
        for (var i = 0; i < stack.length; i++) {
          var node = stack[i];
          if (root.contains(node)) continue; // skip the feedback UI itself
          if (node === document.documentElement || node === document.body) {
            continue;
          }
          target = node;
          break;
        }
      } catch (err) {
        /* elementsFromPoint unsupported / weird DOM — just cancel */
      }
      if (target) {
        picked = {
          label: labelFor(target) || undefined,
          snippet: squish(target.textContent).slice(0, 160) || undefined,
          path: pathFor(target) || undefined,
        };
        try {
          var prior = target.style.outline;
          target.style.outline = "2px solid " + RED;
          setTimeout(function () {
            try {
              target.style.outline = prior;
            } catch (e) {
              /* ignore */
            }
          }, 2500);
        } catch (err) {
          /* ignore */
        }
      }
      endPick();
    });

    pickBtn.addEventListener("click", startPick);

    // ---------- direction detection ----------
    function detectDirection() {
      try {
        var nodes = document.querySelectorAll(
          '[data-direction].active, .dir-btn.active, [aria-pressed="true"]',
        );
        for (var i = 0; i < nodes.length; i++) {
          if (root.contains(nodes[i])) continue;
          var t = squish(nodes[i].textContent);
          if (t) return t.slice(0, 20);
        }
      } catch (e) {
        /* must never throw */
      }
      return undefined;
    }

    // ---------- open / close / send ----------
    function resetForm() {
      mood = null;
      picked = null;
      textarea.value = "";
      errLine.style.display = "none";
      sendBtn.disabled = false;
      sendBtn.textContent = "ОТПРАВИТЬ";
      paintChips();
      paintPicked();
    }

    function closePanel() {
      panel.style.display = "none";
      if (picking) endPick();
    }

    fab.addEventListener("click", function () {
      if (picking) return;
      if (panel.style.display === "none") {
        formWrap.style.display = "block";
        sentMsg.style.display = "none";
        panel.style.display = "block";
        detectDirection(); // lazy poll — result re-read at send time
      } else {
        closePanel();
      }
    });

    closeBtn.addEventListener("click", closePanel);

    sendBtn.addEventListener("click", function () {
      if (sending) return;
      var text = textarea.value.trim();
      if (!text) {
        textarea.focus();
        return;
      }
      sending = true;
      errLine.style.display = "none";
      sendBtn.disabled = true;
      sendBtn.textContent = "ОТПРАВЛЯЮ…";

      var payload = {
        page: location.pathname,
        direction: window.__dcDirection || detectDirection() || undefined,
        section: document.title || undefined,
        mood: mood || undefined,
        text: text,
        element: picked || undefined,
      };

      fetch("/api/feedback/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          sending = false;
          formWrap.style.display = "none";
          sentMsg.style.display = "block";
          setTimeout(function () {
            closePanel();
            resetForm();
            formWrap.style.display = "block";
            sentMsg.style.display = "none";
          }, 1800);
        })
        .catch(function () {
          sending = false;
          sendBtn.disabled = false;
          sendBtn.textContent = "ОТПРАВИТЬ";
          errLine.style.display = "block"; // keep the text for retry
        });
    });

    root.appendChild(overlay);
    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);
  }

  function safeInit() {
    try {
      init();
    } catch (e) {
      // prototype pages are generated HTML — never break the page itself
      if (window.console && console.error) {
        console.error("rempire feedback init failed", e);
      }
    }
  }

  if (document.body) safeInit();
  else document.addEventListener("DOMContentLoaded", safeInit);
})();
