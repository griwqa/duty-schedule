import calendar as cal
from datetime import date

import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side

from core.models import ROLE_EXTRA, ROLE_FIVE_DAY, ShiftType
from core.production_calendar import ProductionCalendar


def export_to_excel(path, engineers, year, month, prod_calendar: ProductionCalendar):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "График"

    _, days_in_month = cal.monthrange(year, month)

    night_fill = PatternFill("solid", fgColor="4472C4")
    daily_fill = PatternFill("solid", fgColor="ED7D31")
    holiday_fill = PatternFill("solid", fgColor="C00000")
    off_fill = PatternFill("solid", fgColor="FFFFFF")
    hdr_fill = PatternFill("solid", fgColor="305496")
    name_fill = PatternFill("solid", fgColor="D9E1F2")
    name_extra_fill = PatternFill("solid", fgColor="E4DFEC")
    name_five_fill = PatternFill("solid", fgColor="E2EFDA")
    weekend_fill = PatternFill("solid", fgColor="FFF2CC")
    morning_fill = PatternFill("solid", fgColor="70AD47")
    day_fill = PatternFill("solid", fgColor="FFC000")
    evening_fill = PatternFill("solid", fgColor="7030A0")
    office_fill = PatternFill("solid", fgColor="DEEBF7")
    remote_fill = PatternFill("solid", fgColor="E2EFDA")
    trip_fill = PatternFill("solid", fgColor="FCE4D6")
    white_font = Font(color="FFFFFF", bold=True)
    bold_font = Font(bold=True)
    center = Alignment(horizontal="center", vertical="center")
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    cell = ws.cell(1, 1, "Инженер")
    cell.fill = hdr_fill
    cell.font = white_font
    cell.alignment = center
    cell.border = border

    for d in range(1, days_in_month + 1):
        c = ws.cell(1, d + 1, d)
        c.fill = hdr_fill
        c.font = white_font
        c.alignment = center
        c.border = border

    for r, eng in enumerate(engineers, start=2):
        nc = ws.cell(r, 1, eng.name)
        if eng.role == ROLE_EXTRA:
            nc.fill = name_extra_fill
        elif eng.role == ROLE_FIVE_DAY:
            nc.fill = name_five_fill
        else:
            nc.fill = name_fill
        nc.font = bold_font
        nc.alignment = center
        nc.border = border

        for d in range(1, days_in_month + 1):
            shift = eng.shifts[d - 1]
            c = ws.cell(r, d + 1)
            c.value = shift.value
            c.alignment = center
            c.border = border

            if shift == ShiftType.NIGHT:
                c.fill = night_fill
                c.font = white_font
            elif shift == ShiftType.DAILY:
                c.fill = daily_fill
                c.font = white_font
            elif shift == ShiftType.HOLIDAY:
                c.fill = holiday_fill
                c.font = white_font
            elif shift == ShiftType.MORNING:
                c.fill = morning_fill
                c.font = white_font
            elif shift == ShiftType.DAY:
                c.fill = day_fill
            elif shift == ShiftType.EVENING:
                c.fill = evening_fill
                c.font = white_font
            elif shift == ShiftType.OFFICE:
                c.fill = office_fill
            elif shift == ShiftType.REMOTE:
                c.fill = remote_fill
            elif shift == ShiftType.TRIP:
                c.fill = trip_fill
            else:
                dt = date(year, month, d)
                if prod_calendar.is_weekend(dt):
                    c.fill = weekend_fill
                else:
                    c.fill = off_fill

    dow_row = len(engineers) + 2
    ws.cell(dow_row, 1, "Д.Н.").fill = name_fill
    ws.cell(dow_row, 1).font = bold_font
    ws.cell(dow_row, 1).alignment = center
    ws.cell(dow_row, 1).border = border

    dow_ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    for d in range(1, days_in_month + 1):
        dt = date(year, month, d)
        c = ws.cell(dow_row, d + 1, dow_ru[dt.weekday()])
        c.alignment = center
        c.font = bold_font
        c.border = border
        if prod_calendar.is_holiday(dt):
            c.fill = holiday_fill
            c.font = white_font
        elif prod_calendar.is_weekend(dt):
            c.fill = weekend_fill

    # Статистика (суточники и 5-дневные, без доп. инженеров)
    norm_hours = prod_calendar.get_norm_hours(year, month)
    mains = [eng for eng in engineers if not eng.is_extra]
    stats_row = dow_row + 2
    ws.cell(stats_row, 1, "Статистика").font = bold_font
    headers = [
        "Инженер",
        "Ночных",
        "Суточных",
        "Праздничных",
        "5-дн.",
        "Часов",
        "Переработка",
    ]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(stats_row + 1, i, h)
        c.font = bold_font
        c.fill = name_fill
        c.border = border

    for i, eng in enumerate(mains):
        row = stats_row + 2 + i
        overtime = eng.total_hours - norm_hours
        values = [
            eng.name,
            eng.night_count,
            eng.daily_count,
            eng.holiday_count,
            eng.five_day_count,
            eng.total_hours,
            overtime,
        ]
        for col, val in enumerate(values, start=1):
            c = ws.cell(row, col, val)
            c.border = border
            c.alignment = center

    ws.column_dimensions["A"].width = 14
    for i in range(2, days_in_month + 2):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = 4.5

    ws.freeze_panes = "B2"
    wb.save(path)
