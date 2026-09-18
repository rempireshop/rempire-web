from pathlib import Path
from math import atan2, cos, sin, pi

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


OUT = Path("output/pdf/rempire-assignment-1-use-cases.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)

# Rempire-inspired palette: warm ink, orange and a restrained gold accent.
INK = colors.HexColor("#201E08")
ORANGE = colors.HexColor("#E9531D")
GOLD = colors.HexColor("#F4B400")
PAPER = colors.HexColor("#FFFDF8")
CREAM = colors.HexColor("#FFF5DE")
PEACH = colors.HexColor("#FFF0E8")
SOFT = colors.HexColor("#F4F2EA")
LINE = colors.HexColor("#D5D0C2")
MUTED = colors.HexColor("#6F6C62")
WHITE = colors.white


def register_fonts():
    font_dir = Path("C:/Windows/Fonts")
    files = {
        "Body": font_dir / "arial.ttf",
        "Body-Bold": font_dir / "arialbd.ttf",
        "Body-Italic": font_dir / "ariali.ttf",
    }
    if all(path.exists() for path in files.values()):
        for name, path in files.items():
            pdfmetrics.registerFont(TTFont(name, str(path)))
        return "Body", "Body-Bold", "Body-Italic"
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


FONT, BOLD, ITALIC = register_fonts()

BODY = ParagraphStyle(
    "Body", fontName=FONT, fontSize=9.4, leading=12.5, textColor=INK
)
SMALL = ParagraphStyle(
    "Small", parent=BODY, fontSize=8.4, leading=10.8
)
LABEL = ParagraphStyle(
    "Label", parent=SMALL, fontName=BOLD
)
NOTE = ParagraphStyle(
    "Note", parent=SMALL, textColor=MUTED
)


def para(text, style=BODY):
    return Paragraph(text, style)


def round_box(c, x, y, w, h, fill=WHITE, stroke=LINE, radius=7, line=0.8):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(line)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)


def brand_header(c, size, label):
    w, h = size
    c.setFillColor(INK)
    c.setFont(BOLD, 9.5)
    c.drawString(18 * mm, h - 15 * mm, "REMPIRE")
    c.setFillColor(ORANGE)
    c.roundRect(18 * mm, h - 18 * mm, 17 * mm, 2.2 * mm, 1, stroke=0, fill=1)
    c.setFillColor(MUTED)
    c.setFont(FONT, 8)
    c.drawRightString(w - 18 * mm, h - 15 * mm, label.upper())


def footer(c, page_no, size):
    w, _ = size
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(18 * mm, 14 * mm, w - 18 * mm, 14 * mm)
    c.setFillColor(MUTED)
    c.setFont(FONT, 7.5)
    c.drawString(18 * mm, 9 * mm, "IT-9114  |  Assignment 1  |  Rempire")
    c.drawRightString(w - 18 * mm, 9 * mm, str(page_no))


def draw_cover(c):
    size = A4
    w, h = size
    c.setFillColor(PAPER)
    c.rect(0, 0, w, h, stroke=0, fill=1)
    brand_header(c, size, "Assignment 1")

    c.setFillColor(GOLD)
    c.roundRect(w - 48 * mm, h - 70 * mm, 30 * mm, 30 * mm, 8, stroke=0, fill=1)
    c.setFillColor(INK)
    c.setFont(BOLD, 25)
    c.drawCentredString(w - 33 * mm, h - 59 * mm, "01")

    c.setFillColor(ORANGE)
    c.setFont(BOLD, 10)
    c.drawString(18 * mm, h - 37 * mm, "USE CASE ANALYSIS")
    c.setFillColor(INK)
    c.setFont(BOLD, 27)
    c.drawString(18 * mm, h - 52 * mm, "Rempire e-commerce")
    c.drawString(18 * mm, h - 64 * mm, "platform")
    c.setFillColor(MUTED)
    c.setFont(FONT, 9)
    c.drawString(18 * mm, h - 74 * mm, "IT-9114 Infosüsteemide analüüs ja projekteerimine")

    round_box(c, 18 * mm, h - 106 * mm, w - 36 * mm, 20 * mm, CREAM, GOLD, 7, 1)
    c.setFillColor(INK)
    c.setFont(BOLD, 8.3)
    c.drawString(23 * mm, h - 95 * mm, "STUDENTS")
    c.setFont(FONT, 9.2)
    c.drawString(48 * mm, h - 95 * mm, "Lauri Saul and Dim Novare")
    c.setFont(BOLD, 8.3)
    c.drawString(139 * mm, h - 95 * mm, "DATE")
    c.setStrokeColor(INK)
    c.setLineWidth(0.6)
    c.line(154 * mm, h - 96 * mm, 185 * mm, h - 96 * mm)

    c.setFillColor(INK)
    c.setFont(BOLD, 15)
    c.drawString(18 * mm, h - 126 * mm, "What is Rempire?")
    intro = para(
        "Rempire is an online shop. Customers use it to find products, add them to a cart, "
        "choose delivery and pay. The store administrator uses the admin panel to update "
        "products and stock, handle orders and manage the shop. Payment, delivery and e-mail "
        "services support these tasks."
    )
    intro.wrapOn(c, w - 36 * mm, 35 * mm)
    intro.drawOn(c, 18 * mm, h - 153 * mm)

    card_y = h - 202 * mm
    gap = 6 * mm
    card_w = (w - 36 * mm - 2 * gap) / 3
    cards = [
        ("CUSTOMER", "Finds products, places an order and receives updates.", PEACH, ORANGE),
        ("ADMINISTRATOR", "Manages products, stock, orders and store content.", CREAM, GOLD),
        ("CONNECTED SERVICES", "Handle payment, delivery and e-mail messages.", SOFT, LINE),
    ]
    for i, (title, text, fill, stroke) in enumerate(cards):
        x = 18 * mm + i * (card_w + gap)
        round_box(c, x, card_y, card_w, 37 * mm, fill, stroke, 7, 1)
        c.setFillColor(ORANGE if i == 0 else INK)
        c.setFont(BOLD, 7.8)
        c.drawString(x + 5 * mm, card_y + 26 * mm, title)
        body = para(text, SMALL)
        body.wrapOn(c, card_w - 10 * mm, 20 * mm)
        body.drawOn(c, x + 5 * mm, card_y + 8 * mm)

    c.setFillColor(INK)
    c.setFont(BOLD, 15)
    c.drawString(18 * mm, h - 211 * mm, "What is included")
    contents = [
        ("1", "Use case diagram", "The main people, services and tasks in the system."),
        ("2", "Place an online order", "A customer use case."),
        ("3", "Fulfil an order", "A store administrator use case."),
    ]
    y = h - 225 * mm
    for number, title, text in contents:
        c.setFillColor(ORANGE)
        c.circle(23 * mm, y + 2 * mm, 4.2 * mm, stroke=0, fill=1)
        c.setFillColor(WHITE)
        c.setFont(BOLD, 8)
        c.drawCentredString(23 * mm, y, number)
        c.setFillColor(INK)
        c.setFont(BOLD, 9.2)
        c.drawString(32 * mm, y + 2 * mm, title)
        c.setFillColor(MUTED)
        c.setFont(FONT, 8.3)
        c.drawString(83 * mm, y + 2 * mm, text)
        y -= 10 * mm

    note_y = 21 * mm
    round_box(c, 18 * mm, note_y, w - 36 * mm, 22 * mm, SOFT, LINE, 6)
    c.setFillColor(INK)
    c.setFont(BOLD, 7.8)
    c.drawString(23 * mm, note_y + 14 * mm, "ASSIGNMENT BRIEF")
    note = para(
        "Work in pairs. Create a use case diagram based on the system description. Complete two "
        "use case templates. The two selected use cases must have different main actors.",
        NOTE,
    )
    note.wrapOn(c, w - 46 * mm, 10 * mm)
    note.drawOn(c, 23 * mm, note_y + 4 * mm)

    footer(c, 1, size)
    c.showPage()


def actor(c, x, y, label):
    c.setStrokeColor(INK)
    c.setLineWidth(1.2)
    c.circle(x, y + 24, 7, stroke=1, fill=0)
    c.line(x, y + 17, x, y - 3)
    c.line(x - 11, y + 10, x + 11, y + 10)
    c.line(x, y - 3, x - 10, y - 18)
    c.line(x, y - 3, x + 10, y - 18)
    c.setFillColor(INK)
    c.setFont(BOLD, 7.4)
    for i, text in enumerate(label.split("\n")):
        c.drawCentredString(x, y - 30 - i * 9, text)


def use_case(c, x, y, w, h, label, kind="normal"):
    fill = PEACH if kind == "primary" else (CREAM if kind == "support" else WHITE)
    stroke = ORANGE if kind == "primary" else (GOLD if kind == "support" else INK)
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(1.8 if kind == "primary" else 0.9)
    c.ellipse(x - w / 2, y - h / 2, x + w / 2, y + h / 2, stroke=1, fill=1)
    c.setFillColor(INK)
    c.setFont(BOLD if kind == "primary" else FONT, 7.5)
    lines = label.split("\n")
    base = y + (len(lines) - 1) * 4.1
    for i, text in enumerate(lines):
        c.drawCentredString(x, base - i * 8.2, text)


def line(c, x1, y1, x2, y2):
    c.setStrokeColor(colors.HexColor("#827E73"))
    c.setLineWidth(0.8)
    c.line(x1, y1, x2, y2)


def include_arrow(c, x1, y1, x2, y2):
    c.saveState()
    c.setDash(4, 3)
    c.setStrokeColor(colors.HexColor("#777269"))
    c.setFillColor(colors.HexColor("#777269"))
    c.setLineWidth(0.7)
    c.line(x1, y1, x2, y2)
    ang = atan2(y2 - y1, x2 - x1)
    for d in (ang + 5 * pi / 6, ang - 5 * pi / 6):
        c.line(x2, y2, x2 + 7 * cos(d), y2 + 7 * sin(d))
    c.setDash()
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    c.setFont(ITALIC, 6.1)
    c.setFillColor(PAPER)
    c.roundRect(mx - 15 * mm, my - 3.4, 30 * mm, 7, 2, stroke=0, fill=1)
    c.setFillColor(MUTED)
    c.drawCentredString(mx, my - 2, "<<include>>")
    c.restoreState()


def diagram_nodes(c):
    nodes = [
        (84, 149, 45, 17, "Browse\nproducts", "normal"),
        (150, 149, 44, 17, "Manage\ncart", "normal"),
        (218, 149, 48, 19, "UC-01\nPlace an order", "primary"),
        (84, 116, 45, 17, "Check price\nand stock", "support"),
        (150, 116, 44, 17, "Choose\ndelivery", "support"),
        (218, 116, 43, 17, "Make\npayment", "support"),
        (84, 74, 47, 19, "UC-02\nFulfil an order", "primary"),
        (150, 74, 45, 17, "Manage products\nand stock", "normal"),
        (218, 74, 46, 17, "Manage shop\ncontent", "normal"),
        (84, 39, 44, 17, "Create shipping\nlabel", "support"),
        (150, 39, 44, 17, "Send order\nupdate", "support"),
        (218, 39, 43, 17, "Record an\nin-store sale", "normal"),
    ]
    for x, y, ww, hh, label, kind in nodes:
        use_case(c, x * mm, y * mm, ww * mm, hh * mm, label, kind)


def draw_diagram(c):
    size = landscape(A4)
    w, h = size
    c.setPageSize(size)
    c.setFillColor(PAPER)
    c.rect(0, 0, w, h, stroke=0, fill=1)
    brand_header(c, size, "Use case diagram")
    c.setFillColor(INK)
    c.setFont(BOLD, 20)
    c.drawString(18 * mm, h - 30 * mm, "How people use Rempire")
    c.setFillColor(MUTED)
    c.setFont(FONT, 8.2)
    c.drawRightString(w - 18 * mm, h - 30 * mm, "The orange use cases are described on pages 3 and 4")

    bx, by, bw, bh = 49 * mm, 24 * mm, 200 * mm, 146 * mm
    c.setFillColor(colors.HexColor("#FFFEFA"))
    c.setStrokeColor(INK)
    c.setLineWidth(1.1)
    c.roundRect(bx, by, bw, bh, 6, stroke=1, fill=1)
    c.setFillColor(INK)
    c.setFont(BOLD, 7.8)
    c.drawString(bx + 4 * mm, by + bh - 6 * mm, "REMPIRE E-COMMERCE PLATFORM")
    c.setStrokeColor(LINE)
    c.setDash(3, 3)
    c.line(bx + 7 * mm, 94 * mm, bx + bw - 7 * mm, 94 * mm)
    c.setDash()
    c.setFillColor(MUTED)
    c.setFont(FONT, 6.8)
    c.drawRightString(bx + bw - 5 * mm, 97 * mm, "STORE OPERATIONS")
    c.drawRightString(bx + bw - 5 * mm, 164 * mm, "CUSTOMER TASKS")

    line(c, 34 * mm, 140 * mm, 61 * mm, 149 * mm)
    line(c, 34 * mm, 138 * mm, 128 * mm, 149 * mm)
    line(c, 34 * mm, 136 * mm, 194 * mm, 149 * mm)
    line(c, 34 * mm, 70 * mm, 61 * mm, 74 * mm)
    line(c, 34 * mm, 68 * mm, 128 * mm, 74 * mm)
    line(c, 34 * mm, 65 * mm, 197 * mm, 39 * mm)
    line(c, 254 * mm, 118 * mm, 239 * mm, 116 * mm)
    line(c, 254 * mm, 81 * mm, 172 * mm, 116 * mm)
    line(c, 254 * mm, 79 * mm, 106 * mm, 39 * mm)
    line(c, 254 * mm, 43 * mm, 172 * mm, 39 * mm)
    include_arrow(c, 208 * mm, 141 * mm, 103 * mm, 122 * mm)
    include_arrow(c, 214 * mm, 140 * mm, 161 * mm, 124 * mm)
    include_arrow(c, 220 * mm, 140 * mm, 218 * mm, 125 * mm)
    include_arrow(c, 88 * mm, 65 * mm, 88 * mm, 48 * mm)
    include_arrow(c, 103 * mm, 70 * mm, 129 * mm, 45 * mm)

    diagram_nodes(c)
    actor(c, 23 * mm, 138 * mm, "Customer")
    actor(c, 23 * mm, 67 * mm, "Store\nadministrator")
    actor(c, 275 * mm, 117 * mm, "Payment\nservice")
    actor(c, 275 * mm, 80 * mm, "Delivery\nservice")
    actor(c, 275 * mm, 42 * mm, "E-mail\nservice")

    use_case(c, 66 * mm, 16 * mm, 26 * mm, 8 * mm, "", "primary")
    c.setFillColor(MUTED)
    c.setFont(FONT, 7)
    c.drawString(81 * mm, 14.7 * mm, "Described in detail")
    c.setDash(4, 3)
    c.setStrokeColor(MUTED)
    c.line(133 * mm, 16 * mm, 153 * mm, 16 * mm)
    c.setDash()
    c.drawString(157 * mm, 14.7 * mm, "Required part of a use case")
    c.setStrokeColor(MUTED)
    c.line(216 * mm, 16 * mm, 236 * mm, 16 * mm)
    c.drawString(240 * mm, 14.7 * mm, "Actor connection")

    footer(c, 2, size)
    c.showPage()


def table_for_use_case(c, rows, x, y_top, width, max_height):
    data = [[para(label, LABEL), para(value, SMALL)] for label, value in rows]
    table = Table(data, colWidths=[39 * mm, width - 39 * mm])
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (0, -1), SOFT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    table.setStyle(TableStyle(style))
    _, height = table.wrap(width, max_height)
    if height > max_height:
        raise RuntimeError(f"Use case table is too tall: {height:.1f} > {max_height:.1f}")
    table.drawOn(c, x, y_top - height)


def draw_template(c, page_no, number, title, actor_name, goal, other_actors, rows):
    size = A4
    w, h = size
    c.setPageSize(size)
    c.setFillColor(PAPER)
    c.rect(0, 0, w, h, stroke=0, fill=1)
    brand_header(c, size, "Use case description")

    c.setFillColor(ORANGE)
    c.roundRect(18 * mm, h - 51 * mm, 25 * mm, 25 * mm, 7, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont(BOLD, 17)
    c.drawCentredString(30.5 * mm, h - 42 * mm, number)
    c.setFillColor(INK)
    c.setFont(BOLD, 21)
    c.drawString(50 * mm, h - 37 * mm, title)
    c.setFillColor(MUTED)
    c.setFont(FONT, 8.5)
    c.drawString(50 * mm, h - 45 * mm, f"Main actor: {actor_name}")

    summary_y = h - 77 * mm
    left_w = 55 * mm
    round_box(c, 18 * mm, summary_y, left_w, 18 * mm, CREAM, GOLD, 6)
    c.setFillColor(INK)
    c.setFont(BOLD, 7.3)
    c.drawString(23 * mm, summary_y + 11 * mm, "OTHER ACTORS")
    c.setFont(FONT, 7.8)
    c.drawString(23 * mm, summary_y + 5 * mm, other_actors)
    round_box(c, 79 * mm, summary_y, w - 97 * mm, 18 * mm, PEACH, ORANGE, 6)
    c.setFillColor(INK)
    c.setFont(BOLD, 7.3)
    c.drawString(84 * mm, summary_y + 11 * mm, "GOAL")
    goal_p = para(goal, SMALL)
    goal_p.wrapOn(c, w - 107 * mm, 8 * mm)
    goal_p.drawOn(c, 84 * mm, summary_y + 3.5 * mm)

    table_for_use_case(c, rows, 18 * mm, h - 85 * mm, w - 36 * mm, h - 110 * mm)
    footer(c, page_no, size)
    c.showPage()


UC1 = [
    ("Use case", "UC-01 - Place an online order"),
    ("Trigger", "The customer opens the cart and chooses <b>Checkout</b>."),
    ("Before it starts", "The shop is available and the cart contains at least one product. The customer does not need an account."),
    ("Main flow", "1. The customer checks the products in the cart.<br/>2. The customer starts checkout and enters contact details.<br/>3. The customer chooses a delivery country and method.<br/>4. The customer selects a parcel point, enters an address or chooses store pickup.<br/>5. The customer may add a promo code, gift card or loyalty points.<br/>6. The customer chooses a payment method and confirms the order.<br/>7. Rempire checks the price, stock and delivery details, then creates the order.<br/>8. The payment service confirms payment.<br/>9. Rempire marks the order as paid, updates stock, sends a confirmation e-mail and shows the receipt."),
    ("Other possible paths", "A. <b>Payment fails:</b> the order stays unpaid and the customer can try again.<br/>B. <b>Price or stock changed:</b> Rempire shows the problem and asks the customer to update the cart.<br/>C. <b>Gift card or points cover the full price:</b> no bank page is needed.<br/>D. <b>Digital gift card:</b> the customer enters recipient details instead of delivery details."),
    ("When it ends", "A paid order and order number are saved. Stock and any used discount balance are updated. The customer sees a receipt and receives an e-mail. If payment is not confirmed, the order is not treated as paid."),
    ("Rules", "Rempire calculates the final price on the server. Payment confirmation is handled only once, even if the payment service sends the same message again. A cart line can contain no more than 9 items."),
]


UC2 = [
    ("Use case", "UC-02 - Fulfil an order"),
    ("Trigger", "The administrator opens a paid order that has not been sent yet."),
    ("Before it starts", "The administrator is signed in. The order is paid, the delivery details are available and the products can be prepared."),
    ("Main flow", "1. The administrator opens the order.<br/>2. Rempire shows the products, customer and delivery details.<br/>3. The administrator picks and packs the products.<br/>4. The administrator asks Rempire to create a shipping label.<br/>5. The delivery service returns the label and tracking number.<br/>6. Rempire saves them and makes the label available for printing.<br/>7. The administrator attaches the label and gives the parcel to the carrier.<br/>8. The administrator chooses <b>Mark as shipped</b> and confirms the action.<br/>9. Rempire changes the order status and sends a shipping e-mail to the customer.<br/>10. Later, the delivery service or administrator marks the order as delivered."),
    ("Other possible paths", "A. <b>Store pickup:</b> no label is needed. The administrator records that the order was handed to the customer.<br/>B. <b>Label service is unavailable:</b> the order stays paid and the administrator can try again.<br/>C. <b>A label already exists:</b> Rempire shows the saved label instead of creating another one.<br/>D. <b>Delivery details are wrong:</b> the administrator contacts the customer and continues after the details are corrected.<br/>E. <b>Digital order:</b> there is no physical fulfilment step."),
    ("When it ends", "The order is marked as shipped or handed to the customer. Label and tracking details are saved when needed. The customer receives an update. The order can later be marked as delivered."),
    ("Rules", "Only paid physical orders can receive a shipping label. Rempire must not create the same shipment twice. The administrator confirms before an order is marked as shipped. The shipping e-mail is sent once."),
]


def build():
    c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
    c.setTitle("Rempire - Assignment 1: Use Cases")
    c.setAuthor("Lauri Saul and Dim Novare")
    c.setSubject("IT-9114 Infosüsteemide analüüs ja projekteerimine")
    draw_cover(c)
    draw_diagram(c)
    draw_template(
        c, 3, "01", "Place an online order", "Customer",
        "Buy products and receive a confirmed order.",
        "Payment, delivery, e-mail",
        UC1,
    )
    draw_template(
        c, 4, "02", "Fulfil an order", "Store administrator",
        "Prepare a paid order and send it to the customer.",
        "Delivery, e-mail",
        UC2,
    )
    c.save()
    print(OUT.resolve())


if __name__ == "__main__":
    build()
