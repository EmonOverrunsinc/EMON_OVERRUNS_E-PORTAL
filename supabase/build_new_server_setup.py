# Builds ONE paste-safe file that sets up a new, empty Supabase project with the whole E-Portal (all updates up to 3.0).
import re, sys
SRC = "/home/user/emon-overruns/supabase/"
FILES = ["portal_init", "002_customers_invoices_payments", "003_statements", "004_update_1_1", "005_update_1_2", "006_update_1_3",
         "007_update_1_4", "008_update_1_5", "009_update_1_6", "010_update_1_7", "011_update_1_8", "012_update_1_9",
         "013_update_2_0", "014_update_2_1", "015_update_2_2", "016_update_2_3", "017_play_store", "018_invoice_po", "019_link_payment", "020_invoice_return", "021_join_us", "022_update_2_9", "023_purchase_orders", "024_eo_office", "025_qc_simple", "026_eo_office_fixes", "027_ebill_release", "028_eportal_name", "029_qc_optional", "030_delete_history", "031_settle_by", "032_employee_id", "033_employee_photo", "034_employee_details", "035_employee_approval", "036_employee_corrections", "037_edit_employee", "038_card_password", "039_card_first_password", "040_purchase_access", "041_eooffice_hr", "042_po_photos", "043_qc_qty", "044_duplicate_check", "045_customer_orders", "046_gate_pass_ai", "047_order_no", "048_delivery_paper", "049_lot_delete", "050_eva_boxes", "051_order_invoice", "052_order_scan", "053_box_find", "054_ai_access", "055_order_delete", "056_delivery_approval", "057_box_no_serial", "058_photo_optional", "059_voucher_account", "060_salary_months", "061_form_visible", "062_edit_completed_order", "063_payroll_pay_salary", "064_charge_as_delivered", "065_verify_privacy", "066_robot_guard", "067_box_lock", "068_names", "069_print_approval", "071_staff_privacy", "072_delivery_edit", "073_legal_terms", "074_customer_portal", "075_legal_reject", "076_legal_evidence", "077_insurance", "078_legal_enforce", "079_legal_no_signature", "080_customer_history", "081_order_follows_delivery", "082_kyc", "083_insurance_due_extension", "084_insurance_account", "085_devices", "086_insurance_on_statement", "087_coverage_words", "088_cod", "089_middle_name", "090_order_tracking", "091_coverage_voucher", "092_employee_location", "093_collection_voucher_key", "094_staff_lock_sss", "095_order_plate", "096_order_no_address", "097_order_car_type", "098_signup_no_code", "099_box_price_sold", "100_box_arrival", "101_box_settings_read", "102_coverage_middle_name", "103_director_salary_no_card", "104_security_seals", "105_more_seals", "106_invoice_due_30_days", "107_terms_paid", "108_invoice_terms_30_days", "109_outlets", "110_outlets_assigned", "111_card_block_expiry_seal", "112_ebill_simple", "113_outlet_daily_cashout", "114_staff_assign_notify", "115_box_match_pcs", "116_order_fix_from_boxes", "117_box_match_batch_first", "118_outlet_expense_edit_director", "119_qc_locked", "120_manila_billing", "121_issuer_signatures", "122_companies_to_manila", "123_outlet_sales_notify", "124_branch_id", "125_sales_rank", "126_achievements", "127_customer_rank_all", "128_outlet_non_working_days", "129_customer_public_identification", "130_medal_rules_tiers_eoid", "131_today_hours_prize_redeem", "132_public_ident_gcash_style", "133_order_no_po", "134_payment_no_pay", "135_outlet_bank_deposit", "136_outlet_rank_rules_notify_sender", "137_outlet_map_verify_trx", "138_people_stamp", "139_sales_report_verify", "140_order_delivery_assign", "141_employee_place_link", "142_prize_pool", "143_seal_by_number", "144_stamp_from_employee", "145_cashout_edit_once", "146_outlet_director_edit_no_delete", "147_outlet_expense_edit", "148_outlet_day_delete", "149_message_notify", "150_employee_transfers", "151_message_delete_30days", "152_office_transfer_accept", "153_transfer_message_stays", "154_web_push"]
parts = []
for f in FILES:
    t = open(SRC + f + ".sql", encoding="utf-8").read().replace("\r", "")
    assert "$sql$" not in t and "$run$" not in t, f
    parts.append(f"\n-- ======== {f}.sql ========\n" + t.rstrip() + "\n")
body = "".join(parts)
chars = sorted({c for c in body if ord(c) > 127})
for c in chars:
    body = body.replace(c, "[[U+%04X]]" % ord(c))
assert all(ord(c) < 128 for c in body)
restore = "".join(f"  s := replace(s, '[[U+{ord(c):04X}]]', chr({ord(c)}));\n" for c in chars)
head = """-- =====================================================================
-- EMON OVERRUNS E-PORTAL - NEW SERVER SETUP (everything up to update 2.2) in ONE file. RUN ONLY THIS FILE, ONCE,
-- on the NEW, EMPTY project.
-- Supabase > your new project > SQL Editor > New query > paste ALL of this file > Run (if asked: "Run this query").
-- At the end it shows: E-PORTAL SERVER READY. If anything fails, nothing is changed and it can be run again.
-- Run it only ONCE: on a project that is already set up it stops with "already exists" and changes nothing.
-- The file has only plain letters (special characters are written [[U+....]] and put back before it runs), and
-- Windows line breaks are taken out, so copy and paste works.
-- Then: the first account that signs up on the E-Portal becomes the Director (Admin).
-- =====================================================================
do $run$
declare
  s text := $sql$"""
tail = """$sql$;
begin
  s := replace(s, chr(13), '');  -- Windows line breaks
""" + restore + """  execute s;
end
$run$;

-- ---------- the result ----------
select case when to_regclass('public.customers') is not null
             and to_regclass('public.contact_messages') is not null
             and to_regclass('public.main_director') is not null
             and to_regprocedure('public.statement_amounts(uuid,date)') is not null
             and to_regprocedure('public.director_edit_customer(uuid,jsonb)') is not null
             and exists (select 1 from storage.buckets where id = 'records')
             and exists (select 1 from pg_trigger where tgname = 'statements_follow')
             and to_regclass('public.customer_orders') is not null and to_regclass('public.ai_gate_log') is not null and to_regclass('public.box_stock') is not null and to_regprocedure('public.save_order_with_boxes(uuid,jsonb,text[])') is not null
        then 'E-PORTAL SERVER READY - ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
             || ' tables, ' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) || ' functions. Next: sign up on the E-Portal.'
        else 'NOT COMPLETE: tell Claude' end as result;
"""
out = head + body + tail
open(SRC + "NEW_SERVER_SETUP.sql", "w", encoding="ascii").write(out)
print(len(out), "bytes;", len(chars), "special characters:", " ".join("%04X" % ord(c) for c in chars))
