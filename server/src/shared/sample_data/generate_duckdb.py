"""
Generate the shared sample_data.duckdb file used by sample_duckdb data sources.

Each domain is a DuckDB schema with demo tables/columns aligned with dashboard
templates and domain_templates.
"""

from __future__ import annotations

import os
import random
from calendar import monthrange
from datetime import date, timedelta
from typing import Callable, List

import duckdb

SEED = 42
ROW_COUNT = 120


def _create_banking(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS banking")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE banking.loans AS
        SELECT
            row_number() OVER () AS loan_id,
            (row_number() OVER () % 5) + 1 AS branch_id,
            (row_number() OVER () % 4) + 1 AS status_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '3 days') AS disbursement_date,
            round(5000 + (random() * 95000), 2) AS principal_amount,
            round(1000 + (random() * 80000), 2) AS outstanding_principal,
            round(0.05 + (random() * 0.12), 4) AS interest_rate,
            (random() < 0.12) AS npl_flag
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE banking.transactions AS
        SELECT
            row_number() OVER () AS transaction_id,
            (row_number() OVER () % 5) + 1 AS branch_id,
            CASE (row_number() OVER () % 4)
                WHEN 0 THEN 'deposit' WHEN 1 THEN 'withdrawal'
                WHEN 2 THEN 'transfer' ELSE 'payment'
            END AS transaction_type,
            round(10 + (random() * 5000), 2) AS amount,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS value_date
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE banking.accounts AS
        SELECT
            row_number() OVER () AS account_id,
            (row_number() OVER () % 40) + 1 AS customer_id,
            round(500 + (random() * 25000), 2) AS current_balance,
            round(100 + (random() * 20000), 2) AS available_balance
        FROM range(1, 81)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE banking.customers AS
        SELECT row_number() OVER () AS customer_id, 'Customer ' || row_number() OVER () AS name
        FROM range(1, 41)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE banking.branches AS
        SELECT row_number() OVER () AS branch_id, 'Branch ' || row_number() OVER () AS name
        FROM range(1, 6)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE banking.payments AS
        SELECT
            row_number() OVER () AS payment_id,
            (row_number() OVER () % 80) + 1 AS account_id,
            round(20 + (random() * 3000), 2) AS total_amount,
            CAST('2024-02-01' AS DATE) + (row_number() OVER () * INTERVAL '4 days') AS value_date
        FROM range(1, 61)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE banking.collateral AS
        SELECT
            row_number() OVER () AS collateral_id,
            (row_number() OVER () % ?) + 1 AS loan_id,
            round(10000 + (random() * 120000), 2) AS value_amount
        FROM range(1, 41)
        """,
        [n],
    )


def _create_insurance(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS insurance")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE insurance.claims AS
        SELECT
            row_number() OVER () AS claim_id,
            (row_number() OVER () % 5) + 1 AS status_id,
            (row_number() OVER () % 4) + 1 AS claim_type_id,
            round(500 + (random() * 15000), 2) AS amount_claimed,
            round(200 + (random() * 12000), 2) AS amount_paid,
            CAST('2024-01-05' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS reported_date,
            CAST('2024-01-20' AS DATE) + (row_number() OVER () * INTERVAL '3 days') AS closed_date
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE insurance.policies AS
        SELECT
            row_number() OVER () AS policy_id,
            (row_number() OVER () % 6) + 1 AS product_line_id,
            (row_number() OVER () % 3) + 1 AS status_id,
            CAST('2023-06-01' AS DATE) + (row_number() OVER () * INTERVAL '5 days') AS start_date
        FROM range(1, 81)
        """
    )


def _create_education(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS education")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE education.students AS
        SELECT row_number() OVER () AS student_id, 'Student ' || row_number() OVER () AS full_name
        FROM range(1, 81)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE education.enrollments AS
        SELECT
            row_number() OVER () AS enrollment_id,
            (row_number() OVER () % 80) + 1 AS student_id,
            (row_number() OVER () % 12) + 1 AS section_id,
            (row_number() OVER () % 4) + 1 AS status_id,
            CAST('2024-01-10' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS enrolled_at
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE education.grades AS
        SELECT
            row_number() OVER () AS grade_id,
            (row_number() OVER () % 80) + 1 AS student_id,
            CASE (row_number() OVER () % 5)
                WHEN 0 THEN 'A' WHEN 1 THEN 'B' WHEN 2 THEN 'C' WHEN 3 THEN 'D' ELSE 'F'
            END AS grade_letter,
            round(55 + (random() * 45), 1) AS score
        FROM range(1, ? + 1)
        """,
        [n],
    )


def _create_energy(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS energy")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE energy.facilities AS
        SELECT
            row_number() OVER () AS facility_id,
            (row_number() OVER () % 4) + 1 AS asset_type_id,
            'Facility ' || row_number() OVER () AS name
        FROM range(1, 21)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE energy.consumption_readings AS
        SELECT
            row_number() OVER () AS reading_id,
            (row_number() OVER () % 20) + 1 AS meter_id,
            (row_number() OVER () % 20) + 1 AS facility_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '1 day') AS reading_date,
            round(50 + (random() * 450), 2) AS kwh
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE energy.bills AS
        SELECT
            row_number() OVER () AS bill_id,
            (row_number() OVER () % 20) + 1 AS facility_id,
            round(80 + (random() * 1200), 2) AS amount_due,
            CAST('2024-02-01' AS DATE) + (row_number() OVER () * INTERVAL '7 days') AS due_date
        FROM range(1, 61)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE energy.emissions AS
        SELECT
            row_number() OVER () AS emission_id,
            (row_number() OVER () % 20) + 1 AS facility_id,
            round(0.5 + (random() * 12), 2) AS co2_tonnes,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '5 days') AS report_date
        FROM range(1, 61)
        """
    )


def _create_govt(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS govt_public_services")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE govt_public_services.service_requests AS
        SELECT
            row_number() OVER () AS request_id,
            (row_number() OVER () % 6) + 1 AS department_id,
            (row_number() OVER () % 5) + 1 AS status_id,
            CAST('2024-01-03' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS submitted_date,
            CASE WHEN random() < 0.7
                THEN CAST('2024-01-20' AS DATE) + (row_number() OVER () * INTERVAL '2 days')
                ELSE NULL END AS resolved_date
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE govt_public_services.feedback AS
        SELECT
            row_number() OVER () AS feedback_id,
            (row_number() OVER () % ?) + 1 AS request_id,
            round(2 + (random() * 3), 1) AS rating
        FROM range(1, 61)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE govt_public_services.payments AS
        SELECT
            row_number() OVER () AS payment_id,
            CASE (row_number() OVER () % 3) WHEN 0 THEN 'tax' WHEN 1 THEN 'fee' ELSE 'fine' END AS payment_type,
            round(10 + (random() * 500), 2) AS amount,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '3 days') AS paid_date
        FROM range(1, 61)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE govt_public_services.permits AS
        SELECT
            row_number() OVER () AS permit_id,
            (row_number() OVER () % 4) + 1 AS permit_type_id,
            CAST('2024-01-15' AS DATE) + (row_number() OVER () * INTERVAL '4 days') AS issued_date
        FROM range(1, 41)
        """
    )


def _create_ecommerce(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS ecommerce")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE ecommerce.customers AS
        SELECT row_number() OVER () AS customer_id, 'Shopper ' || row_number() OVER () AS name
        FROM range(1, 51)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE ecommerce.products AS
        SELECT
            row_number() OVER () AS product_id,
            'Product ' || row_number() OVER () AS name,
            (row_number() OVER () % 8) + 1 AS category_id,
            round(5 + (random() * 250), 2) AS unit_price
        FROM range(1, 41)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE ecommerce.orders AS
        SELECT
            row_number() OVER () AS order_id,
            (row_number() OVER () % 50) + 1 AS customer_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS order_date,
            round(20 + (random() * 800), 2) AS order_total,
            CASE (row_number() OVER () % 4)
                WHEN 0 THEN 'pending' WHEN 1 THEN 'paid' WHEN 2 THEN 'shipped' ELSE 'returned'
            END AS order_status
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE ecommerce.order_items AS
        SELECT
            row_number() OVER () AS line_id,
            (row_number() OVER () % ?) + 1 AS order_id,
            (row_number() OVER () % 40) + 1 AS product_id,
            (1 + (row_number() OVER () % 5)) AS quantity,
            round(5 + (random() * 200), 2) AS unit_price
        FROM range(1, 161)
        """,
        [n],
    )


def _create_retail_supply_chain(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS retail_supply_chain")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE retail_supply_chain.stores AS
        SELECT row_number() OVER () AS store_id, 'Store ' || row_number() OVER () AS name
        FROM range(1, 11)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE retail_supply_chain.suppliers AS
        SELECT row_number() OVER () AS supplier_id, 'Supplier ' || row_number() OVER () AS name
        FROM range(1, 16)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE retail_supply_chain.products AS
        SELECT
            row_number() OVER () AS product_id,
            (row_number() OVER () % 15) + 1 AS supplier_id,
            'SKU-' || row_number() OVER () AS sku,
            round(2 + (random() * 80), 2) AS unit_cost
        FROM range(1, 41)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE retail_supply_chain.inventory AS
        SELECT
            row_number() OVER () AS inventory_id,
            (row_number() OVER () % 40) + 1 AS product_id,
            (row_number() OVER () % 10) + 1 AS store_id,
            (10 + (row_number() OVER () % 200)) AS stock_quantity,
            (5 + (row_number() OVER () % 30)) AS reorder_point
        FROM range(1, 81)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE retail_supply_chain.orders AS
        SELECT
            row_number() OVER () AS order_id,
            (row_number() OVER () % 15) + 1 AS supplier_id,
            (row_number() OVER () % 10) + 1 AS store_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '3 days') AS order_date,
            round(100 + (random() * 5000), 2) AS order_total
        FROM range(1, ? + 1)
        """,
        [n],
    )


def _create_telecom(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS telecom")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE telecom.plans AS
        SELECT row_number() OVER () AS plan_id, 'Plan ' || row_number() OVER () AS name,
               round(10 + (random() * 60), 2) AS monthly_fee
        FROM range(1, 6)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE telecom.subscribers AS
        SELECT
            row_number() OVER () AS subscriber_id,
            (row_number() OVER () % 5) + 1 AS plan_id,
            CAST('2023-05-01' AS DATE) + (row_number() OVER () * INTERVAL '4 days') AS activation_date,
            (random() < 0.08) AS churned
        FROM range(1, 81)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE telecom.usage_records AS
        SELECT
            row_number() OVER () AS usage_id,
            (row_number() OVER () % 80) + 1 AS subscriber_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '1 day') AS usage_date,
            round(0.1 + (random() * 8), 2) AS data_gb,
            (5 + (row_number() OVER () % 120)) AS minutes_used
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE telecom.bills AS
        SELECT
            row_number() OVER () AS bill_id,
            (row_number() OVER () % 80) + 1 AS subscriber_id,
            round(15 + (random() * 85), 2) AS amount_due,
            CAST('2024-02-01' AS DATE) + (row_number() OVER () * INTERVAL '7 days') AS bill_date
        FROM range(1, 81)
        """
    )


def _create_healthcare(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS healthcare")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE healthcare.patients AS
        SELECT
            row_number() OVER () AS patient_id,
            CAST('1970-01-01' AS DATE) + (row_number() OVER () * INTERVAL '120 days') AS date_of_birth,
            CASE (row_number() OVER () % 2) WHEN 0 THEN 'M' ELSE 'F' END AS gender
        FROM range(1, 61)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE healthcare.encounters AS
        SELECT
            row_number() OVER () AS encounter_id,
            (row_number() OVER () % 60) + 1 AS patient_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS admission_date,
            CAST('2024-01-03' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS discharge_date,
            (1 + (row_number() OVER () % 10)) AS length_of_stay,
            round(200 + (random() * 8000), 2) AS cost
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE healthcare.diagnoses AS
        SELECT
            row_number() OVER () AS diagnosis_id,
            (row_number() OVER () % ?) + 1 AS encounter_id,
            'ICD-' || lpad(CAST((row_number() OVER () % 50) + 1 AS VARCHAR), 3, '0') AS icd_code
        FROM range(1, 81)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE healthcare.claims AS
        SELECT
            row_number() OVER () AS claim_id,
            (row_number() OVER () % ?) + 1 AS encounter_id,
            round(100 + (random() * 6000), 2) AS claim_amount,
            CASE (row_number() OVER () % 4)
                WHEN 0 THEN 'submitted' WHEN 1 THEN 'approved' WHEN 2 THEN 'paid' ELSE 'denied'
            END AS status
        FROM range(1, 81)
        """,
        [n],
    )


def _create_saas(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS saas")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE saas.accounts AS
        SELECT row_number() OVER () AS account_id, 'Account ' || row_number() OVER () AS name
        FROM range(1, 31)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE saas.workspaces AS
        SELECT
            row_number() OVER () AS workspace_id,
            (row_number() OVER () % 30) + 1 AS account_id,
            'Workspace ' || row_number() OVER () AS name
        FROM range(1, 41)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE saas.users AS
        SELECT
            row_number() OVER () AS user_id,
            (row_number() OVER () % 40) + 1 AS workspace_id,
            'user' || row_number() OVER () || '@example.com' AS email
        FROM range(1, 61)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE saas.subscriptions AS
        SELECT
            row_number() OVER () AS subscription_id,
            (row_number() OVER () % 30) + 1 AS account_id,
            (row_number() OVER () % 4) + 1 AS plan_id,
            round(29 + (random() * 470), 2) AS mrr,
            CAST('2023-08-01' AS DATE) + (row_number() OVER () * INTERVAL '5 days') AS start_date,
            (random() < 0.1) AS churned
        FROM range(1, 61)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE saas.events AS
        SELECT
            row_number() OVER () AS event_id,
            (row_number() OVER () % 60) + 1 AS user_id,
            CAST('2024-01-01' AS TIMESTAMP) + (row_number() OVER () * INTERVAL '6 hours') AS event_time,
            CASE (row_number() OVER () % 5)
                WHEN 0 THEN 'login' WHEN 1 THEN 'feature_use' WHEN 2 THEN 'export'
                WHEN 3 THEN 'invite' ELSE 'upgrade'
            END AS event_name
        FROM range(1, ? + 1)
        """,
        [n],
    )


def _create_ngo_impact(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS ngo_impact")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE ngo_impact.projects AS
        SELECT
            row_number() OVER () AS project_id,
            'Project ' || row_number() OVER () AS name,
            CASE (row_number() OVER () % 4)
                WHEN 0 THEN 'health' WHEN 1 THEN 'education'
                WHEN 2 THEN 'livelihood' ELSE 'environment'
            END AS sector
        FROM range(1, 16)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE ngo_impact.beneficiaries AS
        SELECT
            row_number() OVER () AS beneficiary_id,
            (row_number() OVER () % 15) + 1 AS project_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '2 days') AS enrolled_date
        FROM range(1, 81)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE ngo_impact.donations AS
        SELECT
            row_number() OVER () AS donation_id,
            (row_number() OVER () % 15) + 1 AS project_id,
            round(50 + (random() * 5000), 2) AS amount,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '3 days') AS donated_at
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE ngo_impact.outcomes AS
        SELECT
            row_number() OVER () AS outcome_id,
            (row_number() OVER () % 15) + 1 AS project_id,
            round(10 + (random() * 90), 1) AS impact_score,
            CAST('2024-03-01' AS DATE) + (row_number() OVER () * INTERVAL '5 days') AS measured_at
        FROM range(1, 61)
        """
    )

def _create_hospitality(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS hospitality")
    n = ROW_COUNT
    conn.execute(
        """
        CREATE OR REPLACE TABLE hospitality.hotels AS
        SELECT
            row_number() OVER () AS hotel_id,
            'Hotel ' || row_number() OVER () AS name,
            CASE (row_number() OVER () % 6)
                WHEN 0 THEN 'Phnom Penh' WHEN 1 THEN 'Siem Reap' WHEN 2 THEN 'Sihanoukville'
                WHEN 3 THEN 'Battambang' WHEN 4 THEN 'Kampot' ELSE 'Kep'
            END AS city,
            (row_number() OVER () % 5) + 1 AS star_rating
        FROM range(1, 21)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE hospitality.rooms AS
        SELECT
            row_number() OVER () AS room_id,
            (row_number() OVER () % 20) + 1 AS hotel_id,
            CASE (row_number() OVER () % 4)
                WHEN 0 THEN 'standard' WHEN 1 THEN 'deluxe' WHEN 2 THEN 'suite' ELSE 'villa'
            END AS room_type,
            round(20 + (random() * 180), 2) AS nightly_rate_usd
        FROM range(1, 121)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE hospitality.guests AS
        SELECT
            row_number() OVER () AS guest_id,
            'Guest ' || row_number() OVER () AS full_name,
            CASE (row_number() OVER () % 8)
                WHEN 0 THEN 'Cambodia' WHEN 1 THEN 'Thailand' WHEN 2 THEN 'Vietnam'
                WHEN 3 THEN 'South Korea' WHEN 4 THEN 'China' WHEN 5 THEN 'France'
                WHEN 6 THEN 'USA' ELSE 'Australia'
            END AS nationality
        FROM range(1, 81)
        """
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE hospitality.bookings AS
        SELECT
            row_number() OVER () AS booking_id,
            (row_number() OVER () % 120) + 1 AS room_id,
            (row_number() OVER () % 80) + 1 AS guest_id,
            CAST('2024-01-01' AS DATE) + (row_number() OVER () * INTERVAL '1 day') AS check_in_date,
            (row_number() OVER () % 7) + 1 AS nights,
            CASE (row_number() OVER () % 5)
                WHEN 0 THEN 'confirmed' WHEN 1 THEN 'checked_in' WHEN 2 THEN 'checked_out'
                WHEN 3 THEN 'cancelled' ELSE 'no_show'
            END AS status,
            CASE (row_number() OVER () % 4)
                WHEN 0 THEN 'direct' WHEN 1 THEN 'booking.com' WHEN 2 THEN 'agoda' ELSE 'travel_agent'
            END AS booking_channel,
            round(30 + (random() * 800), 2) AS total_amount_usd
        FROM range(1, ? + 1)
        """,
        [n],
    )
    conn.execute(
        """
        CREATE OR REPLACE TABLE hospitality.reviews AS
        SELECT
            row_number() OVER () AS review_id,
            (row_number() OVER () % 20) + 1 AS hotel_id,
            (row_number() OVER () % 80) + 1 AS guest_id,
            (row_number() OVER () % 5) + 1 AS rating,
            CAST('2024-01-15' AS DATE) + (row_number() OVER () * INTERVAL '4 days') AS reviewed_at
        FROM range(1, 161)
        """
    )

def _create_accounting(conn: duckdb.DuckDBPyConnection) -> None:
    catalog_name = conn.execute("SELECT current_database()").fetchone()[0]
    schema_sql = f'"{catalog_name}"."accounting"'
    conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_sql}")

    rng = random.Random(SEED)
    fx_rate = 4100
    start_date = date(2024, 1, 1)
    end_date = date(2025, 12, 31)

    def date_key(value: date) -> int:
        return value.year * 10000 + value.month * 100 + value.day

    def month_key(value: date) -> int:
        return value.year * 100 + value.month

    def month_end(year: int, month: int) -> date:
        return date(year, month, monthrange(year, month)[1])

    def add_journal_entry(
        rows: list[tuple],
        entry_id: int,
        entry_date: date,
        source: str,
        source_id: str,
        memo: str,
        lines: list[tuple[int, float, float]],
    ) -> int:
        for account_id, debit_usd, credit_usd in lines:
            rows.append(
                (
                    len(rows) + 1,
                    entry_id,
                    date_key(entry_date),
                    account_id,
                    source,
                    source_id,
                    memo,
                    round(debit_usd, 2),
                    round(credit_usd, 2),
                )
            )
        return entry_id + 1

    accounts = [
        (1, "1000", "Cash on Hand - USD", "Asset", "Bank", "Debit", True),
        (2, "1010", "ABA Bank Operating", "Asset", "Bank", "Debit", True),
        (3, "1020", "ACLEDA Bank Savings", "Asset", "Bank", "Debit", True),
        (4, "1030", "Wing Wallet", "Asset", "Bank", "Debit", True),
        (5, "1100", "Accounts Receivable", "Asset", "Accounts Receivable", "Debit", False),
        (6, "1200", "Inventory", "Asset", "Inventory", "Debit", False),
        (7, "1300", "Prepaid Rent", "Asset", "Prepaid Expense", "Debit", False),
        (8, "2000", "Accounts Payable", "Liability", "Accounts Payable", "Credit", False),
        (9, "2100", "VAT Payable", "Liability", "VAT Payable", "Credit", False),
        (10, "2200", "Payroll Liabilities", "Liability", "Accrued Expense", "Credit", False),
        (11, "3000", "Owner Capital", "Equity", "Equity", "Credit", False),
        (12, "4000", "Product Sales", "Income", "Revenue", "Credit", False),
        (13, "4100", "Service Revenue", "Income", "Revenue", "Credit", False),
        (14, "4200", "Zero-Rated Export Sales", "Income", "Revenue", "Credit", False),
        (15, "5000", "Cost of Goods Sold", "Expense", "COGS", "Debit", False),
        (16, "6000", "Rent Expense", "Expense", "Operating Expense", "Debit", False),
        (17, "6100", "Utilities Expense", "Expense", "Operating Expense", "Debit", False),
        (18, "6200", "Telecom Expense", "Expense", "Operating Expense", "Debit", False),
        (19, "6300", "Marketing Expense", "Expense", "Operating Expense", "Debit", False),
        (20, "6400", "Salaries Expense", "Expense", "Operating Expense", "Debit", False),
        (21, "6500", "Bank Fees Expense", "Expense", "Operating Expense", "Debit", False),
        (22, "6600", "Professional Fees Expense", "Expense", "Operating Expense", "Debit", False),
        (23, "6700", "Office Supplies Expense", "Expense", "Operating Expense", "Debit", False),
    ]
    customers = [
        (1, "Brown Coffee", "Corporate", "Phnom Penh", "Phnom Penh", "KH", 15, "USD"),
        (2, "Chip Mong Retail", "Corporate", "Phnom Penh", "Phnom Penh", "KH", 30, "USD"),
        (3, "Lucky Supermarket", "Wholesale", "Phnom Penh", "Phnom Penh", "KH", 30, "USD"),
        (4, "Phnom Penh Hotel", "Corporate", "Phnom Penh", "Phnom Penh", "KH", 15, "USD"),
        (5, "Angkor Market", "Retail", "Siem Reap", "Siem Reap", "KH", 15, "USD"),
        (6, "Sabay Digital", "Corporate", "Phnom Penh", "Phnom Penh", "KH", 30, "USD"),
        (7, "Canadia Tower Cafe", "Retail", "Phnom Penh", "Phnom Penh", "KH", 0, "USD"),
        (8, "Kampot Pepper Cooperative", "Wholesale", "Kampot", "Kampot", "KH", 30, "USD"),
        (9, "Battambang Rice Mill", "Wholesale", "Battambang", "Battambang", "KH", 30, "USD"),
        (10, "Ministry Training Center", "Government", "Phnom Penh", "Phnom Penh", "KH", 30, "USD"),
        (11, "Sihanoukville Logistics", "Corporate", "Sihanoukville", "Preah Sihanouk", "KH", 15, "USD"),
        (12, "Siem Reap Boutique Resort", "Corporate", "Siem Reap", "Siem Reap", "KH", 30, "USD"),
        (13, "Koh Kong Eco Tours", "Retail", "Khemarak Phoumin", "Koh Kong", "KH", 15, "USD"),
        (14, "AEON Mall Vendor Booth", "Retail", "Phnom Penh", "Phnom Penh", "KH", 0, "USD"),
        (15, "Ratanakiri Agri Shop", "Wholesale", "Banlung", "Ratanakiri", "KH", 30, "USD"),
        (16, "Banteay Meanchey Distributor", "Wholesale", "Sisophon", "Banteay Meanchey", "KH", 30, "USD"),
    ]
    vendors = [
        (1, "EDC", "Utilities", 15),
        (2, "Phnom Penh Water Supply Authority", "Utilities", 15),
        (3, "Cellcard", "Telecom", 15),
        (4, "Smart Axiata", "Telecom", 15),
        (5, "ABA Bank", "Professional", 0),
        (6, "ACLEDA Bank", "Professional", 0),
        (7, "Canadia Bank", "Professional", 0),
        (8, "VTrust Office Center", "Rent", 30),
        (9, "Khmer24 Ads", "Marketing", 15),
        (10, "Cambodia Post", "Professional", 15),
        (11, "Phnom Penh Packaging", "Inventory", 30),
        (12, "Kampot Farm Supply", "Inventory", 30),
        (13, "Angkor Printing House", "Marketing", 15),
        (14, "General Department of Taxation", "Professional", 0),
    ]
    products = [
        (1, "Kampot Pepper Pack", "Product", "Food Retail", 6.50, 3.20, 0.10),
        (2, "Arabica Coffee Beans 1kg", "Product", "Food Retail", 10.00, 5.20, 0.10),
        (3, "Office Meal Box", "Product", "Catering", 4.50, 2.30, 0.10),
        (4, "Corporate Catering Service", "Service", "Catering", 320.00, 170.00, 0.10),
        (5, "POS Setup Service", "Service", "Professional Services", 450.00, 120.00, 0.10),
        (6, "Monthly Bookkeeping Service", "Service", "Finance Service", 180.00, 60.00, 0.10),
        (7, "Export Rice Sample", "Product", "Export", 22.00, 12.00, 0.00),
        (8, "Training Workshop", "Service", "Training", 750.00, 220.00, 0.00),
        (9, "Retail Supply Bundle", "Product", "Retail", 95.00, 57.00, 0.10),
        (10, "Data Dashboard Service", "Service", "Professional Services", 1200.00, 250.00, 0.10),
    ]
    taxes = [
        (1, "VAT 10%", 0.10),
        (2, "Zero-Rated", 0.00),
        (3, "Exempt", 0.00),
    ]
    customer_by_id = {row[0]: row for row in customers}
    vendor_by_id = {row[0]: row for row in vendors}
    product_by_id = {row[0]: row for row in products}
    expense_account_by_category = {
        "Utilities": 17,
        "Rent": 16,
        "Inventory": 6,
        "Marketing": 19,
        "Professional": 22,
        "Telecom": 18,
    }
    bank_account_by_name = {"Cash": 1, "ABA": 2, "ACLEDA": 3, "Wing": 4}
    bank_by_method = {
        "ABA Pay": "ABA",
        "Wing": "Wing",
        "ACLEDA": "ACLEDA",
        "Cash USD": "Cash",
        "Bank Transfer": "ABA",
    }

    dim_dates = []
    current = start_date
    while current <= end_date:
        dim_dates.append(
            (
                date_key(current),
                current,
                current.day,
                current.month,
                current.strftime("%B"),
                (current.month - 1) // 3 + 1,
                current.year,
                current == month_end(current.year, current.month),
                current.weekday() >= 5,
            )
        )
        current += timedelta(days=1)

    invoice_rows = []
    invoice_line_rows = []
    bill_rows = []
    payment_rows = []
    bank_txn_base_rows = []
    journal_rows = []
    invoice_payment_events = []
    bill_payment_events = []
    monthly_activity: dict[int, dict[str, float]] = {}
    journal_entry_id = 1
    payment_id = 1
    bank_txn_id = 1
    invoice_id = 1
    invoice_line_id = 1
    bill_id = 1

    journal_entry_id = add_journal_entry(
        journal_rows,
        journal_entry_id,
        start_date,
        "Manual",
        "OPENING-2024",
        "Opening balances",
        [
            (1, 3500.00, 0.00),
            (2, 18500.00, 0.00),
            (3, 12500.00, 0.00),
            (4, 2100.00, 0.00),
            (6, 8400.00, 0.00),
            (11, 0.00, 45000.00),
        ],
    )

    seasonality = {
        1: 0.90,
        2: 0.82,
        3: 1.00,
        4: 0.95,
        5: 1.05,
        6: 1.10,
        7: 1.05,
        8: 1.00,
        9: 1.10,
        10: 1.20,
        11: 1.35,
        12: 1.50,
    }

    for month_offset in range(24):
        year = 2024 + ((month_offset) // 12)
        month = (month_offset % 12) + 1
        month_start = date(year, month, 1)
        days_in_month = monthrange(year, month)[1]
        mkey = month_key(month_start)
        monthly_activity[mkey] = {
            "revenue": 0.0,
            "cogs": 0.0,
            "opex": 0.0,
            "invoice_tax": 0.0,
            "bill_tax": 0.0,
        }
        growth = 1.0 if year == 2024 else 1.15
        invoice_count = 8 + int(seasonality[month] * 3) + rng.randint(0, 3)

        for _ in range(invoice_count):
            invoice_date = date(year, month, rng.randint(1, min(25, days_in_month)))
            customer = customer_by_id[rng.randint(1, len(customers))]
            terms_days = customer[6]
            due_date = invoice_date + timedelta(days=terms_days)
            line_count = rng.randint(1, 3)
            subtotal = 0.0
            tax_total = 0.0
            cogs_total = 0.0
            revenue_by_account = {12: 0.0, 13: 0.0, 14: 0.0}

            for _line in range(line_count):
                product = product_by_id[rng.randint(1, len(products))]
                if product[2] == "Service":
                    qty = rng.randint(1, 3)
                else:
                    qty = rng.randint(4, 38)
                unit_price = round(product[4] * growth * rng.uniform(0.92, 1.08), 2)
                line_total = round(qty * unit_price, 2)
                tax_usd = round(line_total * product[6], 2)
                revenue_account_id = 14 if product[6] == 0 and product[6] == 0.0 and product[3] == "Export" else 13
                if product[2] == "Product" and product[3] != "Export":
                    revenue_account_id = 12
                revenue_by_account[revenue_account_id] += line_total
                subtotal += line_total
                tax_total += tax_usd
                cogs_total += round(qty * product[5], 2)
                invoice_line_rows.append(
                    (
                        invoice_line_id,
                        invoice_id,
                        product[0],
                        qty,
                        unit_price,
                        line_total,
                        tax_usd,
                    )
                )
                invoice_line_id += 1

            subtotal = round(subtotal, 2)
            tax_total = round(tax_total, 2)
            total = round(subtotal + tax_total, 2)
            due_age_days = (end_date - due_date).days
            is_recent = invoice_date >= date(2025, 11, 20)
            is_draft = is_recent and rng.random() < 0.08
            paid_date = None
            if is_draft:
                amount_paid = 0.0
                status = "Draft"
            elif due_age_days > 30 and rng.random() < 0.84:
                paid_date = min(due_date + timedelta(days=rng.randint(0, 18)), end_date)
                amount_paid = total
                status = "Paid"
            elif rng.random() < 0.14:
                paid_date = min(invoice_date + timedelta(days=rng.randint(5, 40)), end_date)
                amount_paid = round(total * rng.uniform(0.35, 0.80), 2)
                status = "Partially Paid"
            else:
                amount_paid = 0.0
                status = "Overdue" if due_date < end_date else "Open"
            balance_due = round(total - amount_paid, 2)
            days_overdue = max(0, (end_date - due_date).days) if balance_due > 0 and due_date < end_date else 0

            invoice_rows.append(
                (
                    invoice_id,
                    date_key(invoice_date),
                    date_key(due_date),
                    date_key(paid_date) if paid_date else None,
                    customer[0],
                    subtotal,
                    tax_total,
                    total,
                    round(total * fx_rate, 2),
                    amount_paid,
                    balance_due,
                    status,
                    days_overdue,
                )
            )

            if status != "Draft":
                monthly_activity[mkey]["revenue"] += subtotal
                monthly_activity[mkey]["cogs"] += cogs_total
                monthly_activity[mkey]["invoice_tax"] += tax_total
                sale_lines = [(5, total, 0.0)]
                sale_lines.extend(
                    (account_id, 0.0, amount)
                    for account_id, amount in revenue_by_account.items()
                    if amount
                )
                if tax_total:
                    sale_lines.append((9, 0.0, tax_total))
                journal_entry_id = add_journal_entry(
                    journal_rows,
                    journal_entry_id,
                    invoice_date,
                    "Invoice",
                    f"INV-{invoice_id:05d}",
                    f"Invoice to {customer[1]}",
                    sale_lines,
                )
                journal_entry_id = add_journal_entry(
                    journal_rows,
                    journal_entry_id,
                    invoice_date,
                    "Invoice",
                    f"INV-{invoice_id:05d}-COGS",
                    f"COGS for invoice {invoice_id:05d}",
                    [(15, cogs_total, 0.0), (6, 0.0, cogs_total)],
                )

            if amount_paid > 0 and paid_date:
                method = rng.choice(["ABA Pay", "Wing", "ACLEDA", "Cash USD", "Bank Transfer"])
                bank_name = bank_by_method[method]
                reference = f"INV-{invoice_id:05d}"
                payment_rows.append(
                    (
                        payment_id,
                        date_key(paid_date),
                        "Received",
                        "Customer",
                        customer[0],
                        method,
                        amount_paid,
                        reference,
                    )
                )
                invoice_payment_events.append((invoice_id, paid_date, amount_paid))
                bank_txn_base_rows.append(
                    (
                        bank_txn_id,
                        date_key(paid_date),
                        bank_name,
                        "Inflow",
                        "AR Collection",
                        amount_paid,
                    )
                )
                journal_entry_id = add_journal_entry(
                    journal_rows,
                    journal_entry_id,
                    paid_date,
                    "Payment",
                    f"PMT-{payment_id:05d}",
                    f"Customer payment {reference}",
                    [(bank_account_by_name[bank_name], amount_paid, 0.0), (5, 0.0, amount_paid)],
                )
                payment_id += 1
                bank_txn_id += 1

            invoice_id += 1

        bill_count = 6 + rng.randint(0, 3)
        for _ in range(bill_count):
            bill_date = date(year, month, rng.randint(1, min(24, days_in_month)))
            vendor = vendor_by_id[rng.randint(1, len(vendors))]
            category = vendor[2]
            account_id = expense_account_by_category[category]
            if category == "Rent":
                subtotal = round(rng.uniform(1600, 2600) * growth, 2)
            elif category == "Inventory":
                subtotal = round(rng.uniform(800, 4200) * growth, 2)
            elif category == "Marketing":
                subtotal = round(rng.uniform(300, 1800) * growth, 2)
            elif category == "Utilities":
                subtotal = round(rng.uniform(140, 850) * growth, 2)
            elif category == "Telecom":
                subtotal = round(rng.uniform(80, 420) * growth, 2)
            else:
                subtotal = round(rng.uniform(180, 1500) * growth, 2)
            tax_usd = 0.0 if vendor[0] in (5, 6, 7, 14) else round(subtotal * 0.10, 2)
            total = round(subtotal + tax_usd, 2)
            due_date = bill_date + timedelta(days=vendor[3])
            due_age_days = (end_date - due_date).days
            if due_age_days > 20 and rng.random() < 0.88:
                paid_date = min(due_date + timedelta(days=rng.randint(0, 15)), end_date)
                amount_paid = total
                status = "Paid"
            elif rng.random() < 0.10:
                paid_date = min(bill_date + timedelta(days=rng.randint(5, 35)), end_date)
                amount_paid = round(total * rng.uniform(0.35, 0.75), 2)
                status = "Partially Paid"
            else:
                paid_date = None
                amount_paid = 0.0
                status = "Overdue" if due_date < end_date else "Open"
            balance_due = round(total - amount_paid, 2)
            days_overdue = max(0, (end_date - due_date).days) if balance_due > 0 and due_date < end_date else 0
            bill_rows.append(
                (
                    bill_id,
                    date_key(bill_date),
                    date_key(due_date),
                    date_key(paid_date) if paid_date else None,
                    vendor[0],
                    account_id,
                    subtotal,
                    tax_usd,
                    total,
                    round(total * fx_rate, 2),
                    amount_paid,
                    balance_due,
                    status,
                    days_overdue,
                )
            )
            if category != "Inventory":
                monthly_activity[mkey]["opex"] += subtotal
            monthly_activity[mkey]["bill_tax"] += tax_usd
            journal_entry_id = add_journal_entry(
                journal_rows,
                journal_entry_id,
                bill_date,
                "Bill",
                f"BILL-{bill_id:05d}",
                f"Bill from {vendor[1]}",
                [(account_id, subtotal, 0.0), (9, tax_usd, 0.0), (8, 0.0, total)],
            )

            if amount_paid > 0 and paid_date:
                method = rng.choice(["ABA Pay", "ACLEDA", "Cash USD", "Bank Transfer"])
                bank_name = bank_by_method[method]
                reference = f"BILL-{bill_id:05d}"
                payment_rows.append(
                    (
                        payment_id,
                        date_key(paid_date),
                        "Paid",
                        "Vendor",
                        vendor[0],
                        method,
                        amount_paid,
                        reference,
                    )
                )
                bill_payment_events.append((bill_id, paid_date, amount_paid))
                bank_txn_base_rows.append(
                    (
                        bank_txn_id,
                        date_key(paid_date),
                        bank_name,
                        "Outflow",
                        f"AP Payment - {category}",
                        amount_paid,
                    )
                )
                journal_entry_id = add_journal_entry(
                    journal_rows,
                    journal_entry_id,
                    paid_date,
                    "Payment",
                    f"PMT-{payment_id:05d}",
                    f"Vendor payment {reference}",
                    [(8, amount_paid, 0.0), (bank_account_by_name[bank_name], 0.0, amount_paid)],
                )
                payment_id += 1
                bank_txn_id += 1
            bill_id += 1

        payroll_date = date(year, month, min(25, days_in_month))
        payroll_amount = round((5200 + rng.uniform(-450, 700)) * growth, 2)
        monthly_activity[mkey]["opex"] += payroll_amount
        bank_txn_base_rows.append(
            (bank_txn_id, date_key(payroll_date), "ABA", "Outflow", "Payroll", payroll_amount)
        )
        journal_entry_id = add_journal_entry(
            journal_rows,
            journal_entry_id,
            payroll_date,
            "Payroll",
            f"PAYROLL-{mkey}",
            "Monthly payroll",
            [(20, payroll_amount, 0.0), (2, 0.0, payroll_amount)],
        )
        bank_txn_id += 1

        fees_date = date(year, month, min(28, days_in_month))
        bank_fees = round(rng.uniform(18, 65), 2)
        monthly_activity[mkey]["opex"] += bank_fees
        bank_txn_base_rows.append(
            (bank_txn_id, date_key(fees_date), "ABA", "Outflow", "Bank Fees", bank_fees)
        )
        journal_entry_id = add_journal_entry(
            journal_rows,
            journal_entry_id,
            fees_date,
            "BankTxn",
            f"BANKFEE-{mkey}",
            "Bank fees",
            [(21, bank_fees, 0.0), (2, 0.0, bank_fees)],
        )
        bank_txn_id += 1

        if month_offset > 0:
            prior_month = month_start - timedelta(days=1)
            prior_key = month_key(prior_month)
            prior_vat_due = monthly_activity[prior_key]["invoice_tax"] - monthly_activity[prior_key]["bill_tax"]
            if prior_vat_due > 50:
                vat_payment = round(prior_vat_due * 0.90, 2)
                tax_date = date(year, month, min(20, days_in_month))
                bank_txn_base_rows.append(
                    (bank_txn_id, date_key(tax_date), "ACLEDA", "Outflow", "VAT Remittance", vat_payment)
                )
                journal_entry_id = add_journal_entry(
                    journal_rows,
                    journal_entry_id,
                    tax_date,
                    "BankTxn",
                    f"VAT-{prior_key}",
                    "VAT remittance to GDT",
                    [(9, vat_payment, 0.0), (3, 0.0, vat_payment)],
                )
                bank_txn_id += 1

    bank_balances = {"Cash": 3500.00, "ABA": 18500.00, "ACLEDA": 12500.00, "Wing": 2100.00}
    bank_transaction_rows = []
    for txn in sorted(bank_txn_base_rows, key=lambda row: (row[1], row[0])):
        txn_id, txn_date_key, bank_name, direction, category, amount = txn
        if direction == "Inflow":
            bank_balances[bank_name] += amount
        else:
            bank_balances[bank_name] -= amount
        bank_transaction_rows.append(
            (
                txn_id,
                txn_date_key,
                bank_name,
                direction,
                category,
                round(amount, 2),
                round(bank_balances[bank_name], 2),
            )
        )

    monthly_financial_rows = []
    for month_offset in range(24):
        year = 2024 + ((month_offset) // 12)
        month = (month_offset % 12) + 1
        eom = month_end(year, month)
        mkey = month_key(eom)
        revenue = round(monthly_activity[mkey]["revenue"], 2)
        cogs = round(monthly_activity[mkey]["cogs"], 2)
        gross_profit = round(revenue - cogs, 2)
        opex = round(monthly_activity[mkey]["opex"], 2)
        ebitda = round(gross_profit - opex, 2)
        net_profit = ebitda
        cash_balance = round(
            36500.00
            + sum(row[5] if row[3] == "Inflow" else -row[5] for row in bank_transaction_rows if row[1] <= date_key(eom)),
            2,
        )
        ar_balance = round(
            sum(row[7] for row in invoice_rows if row[1] <= date_key(eom) and row[11] != "Draft")
            - sum(amount for _, paid_date, amount in invoice_payment_events if paid_date <= eom),
            2,
        )
        ap_balance = round(
            sum(row[8] for row in bill_rows if row[1] <= date_key(eom))
            - sum(amount for _, paid_date, amount in bill_payment_events if paid_date <= eom),
            2,
        )
        budget_revenue = round((22000 + month_offset * 650) * seasonality[month], 2)
        budget_opex = round(11800 + month_offset * 175, 2)
        monthly_financial_rows.append(
            (
                mkey,
                revenue,
                cogs,
                gross_profit,
                opex,
                ebitda,
                net_profit,
                cash_balance,
                ar_balance,
                ap_balance,
                budget_revenue,
                budget_opex,
            )
        )

    table_sql = [
        """
        CREATE OR REPLACE TABLE main.accounting.dim_date (
            date_key INTEGER,
            full_date DATE,
            day INTEGER,
            month INTEGER,
            month_name VARCHAR,
            quarter INTEGER,
            year INTEGER,
            is_month_end BOOLEAN,
            is_weekend BOOLEAN
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.dim_account (
            account_id INTEGER,
            account_code VARCHAR,
            account_name VARCHAR,
            account_type VARCHAR,
            account_subtype VARCHAR,
            normal_balance VARCHAR,
            is_cash_account BOOLEAN
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.dim_customer (
            customer_id INTEGER,
            customer_name VARCHAR,
            segment VARCHAR,
            city VARCHAR,
            province VARCHAR,
            country VARCHAR,
            payment_terms_days INTEGER,
            currency VARCHAR
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.dim_vendor (
            vendor_id INTEGER,
            vendor_name VARCHAR,
            category VARCHAR,
            payment_terms_days INTEGER
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.dim_product (
            product_id INTEGER,
            product_name VARCHAR,
            item_type VARCHAR,
            category VARCHAR,
            unit_price_usd DOUBLE,
            unit_cost_usd DOUBLE,
            default_tax_rate DOUBLE
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.dim_tax (
            tax_id INTEGER,
            tax_name VARCHAR,
            rate DOUBLE
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.fact_journal (
            journal_line_id INTEGER,
            journal_entry_id INTEGER,
            date_key INTEGER,
            account_id INTEGER,
            source VARCHAR,
            source_id VARCHAR,
            memo VARCHAR,
            debit_usd DOUBLE,
            credit_usd DOUBLE
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.fact_invoices (
            invoice_id INTEGER,
            invoice_date_key INTEGER,
            due_date_key INTEGER,
            paid_date_key INTEGER,
            customer_id INTEGER,
            subtotal_usd DOUBLE,
            tax_usd DOUBLE,
            total_usd DOUBLE,
            total_khr DOUBLE,
            amount_paid_usd DOUBLE,
            balance_due_usd DOUBLE,
            status VARCHAR,
            days_overdue INTEGER
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.fact_invoice_lines (
            line_id INTEGER,
            invoice_id INTEGER,
            product_id INTEGER,
            qty INTEGER,
            unit_price_usd DOUBLE,
            line_total_usd DOUBLE,
            tax_usd DOUBLE
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.fact_bills (
            bill_id INTEGER,
            bill_date_key INTEGER,
            due_date_key INTEGER,
            paid_date_key INTEGER,
            vendor_id INTEGER,
            expense_account_id INTEGER,
            subtotal_usd DOUBLE,
            tax_usd DOUBLE,
            total_usd DOUBLE,
            total_khr DOUBLE,
            amount_paid_usd DOUBLE,
            balance_due_usd DOUBLE,
            status VARCHAR,
            days_overdue INTEGER
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.fact_payments (
            payment_id INTEGER,
            date_key INTEGER,
            direction VARCHAR,
            party_type VARCHAR,
            party_id INTEGER,
            method VARCHAR,
            amount_usd DOUBLE,
            reference VARCHAR
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.fact_bank_transactions (
            txn_id INTEGER,
            date_key INTEGER,
            bank_account VARCHAR,
            direction VARCHAR,
            category VARCHAR,
            amount_usd DOUBLE,
            running_balance_usd DOUBLE
        )
        """,
        """
        CREATE OR REPLACE TABLE main.accounting.fact_monthly_financials (
            month_key INTEGER,
            revenue_usd DOUBLE,
            cogs_usd DOUBLE,
            gross_profit_usd DOUBLE,
            opex_usd DOUBLE,
            ebitda_usd DOUBLE,
            net_profit_usd DOUBLE,
            cash_balance_usd DOUBLE,
            ar_balance_usd DOUBLE,
            ap_balance_usd DOUBLE,
            budget_revenue_usd DOUBLE,
            budget_opex_usd DOUBLE
        )
        """,
    ]
    for statement in table_sql:
        conn.execute(statement.replace("main.accounting", schema_sql))

    def insert_many(table: str, columns: list[str], rows: list[tuple]) -> None:
        placeholders = ", ".join(["?"] * len(columns))
        column_sql = ", ".join(columns)
        conn.executemany(
            f"INSERT INTO {schema_sql}.{table} ({column_sql}) VALUES ({placeholders})",
            rows,
        )

    insert_many(
        "dim_date",
        ["date_key", "full_date", "day", "month", "month_name", "quarter", "year", "is_month_end", "is_weekend"],
        dim_dates,
    )
    insert_many(
        "dim_account",
        ["account_id", "account_code", "account_name", "account_type", "account_subtype", "normal_balance", "is_cash_account"],
        accounts,
    )
    insert_many(
        "dim_customer",
        ["customer_id", "customer_name", "segment", "city", "province", "country", "payment_terms_days", "currency"],
        customers,
    )
    insert_many("dim_vendor", ["vendor_id", "vendor_name", "category", "payment_terms_days"], vendors)
    insert_many(
        "dim_product",
        ["product_id", "product_name", "item_type", "category", "unit_price_usd", "unit_cost_usd", "default_tax_rate"],
        products,
    )
    insert_many("dim_tax", ["tax_id", "tax_name", "rate"], taxes)
    insert_many(
        "fact_journal",
        ["journal_line_id", "journal_entry_id", "date_key", "account_id", "source", "source_id", "memo", "debit_usd", "credit_usd"],
        journal_rows,
    )
    insert_many(
        "fact_invoices",
        [
            "invoice_id",
            "invoice_date_key",
            "due_date_key",
            "paid_date_key",
            "customer_id",
            "subtotal_usd",
            "tax_usd",
            "total_usd",
            "total_khr",
            "amount_paid_usd",
            "balance_due_usd",
            "status",
            "days_overdue",
        ],
        invoice_rows,
    )
    insert_many(
        "fact_invoice_lines",
        ["line_id", "invoice_id", "product_id", "qty", "unit_price_usd", "line_total_usd", "tax_usd"],
        invoice_line_rows,
    )
    insert_many(
        "fact_bills",
        [
            "bill_id",
            "bill_date_key",
            "due_date_key",
            "paid_date_key",
            "vendor_id",
            "expense_account_id",
            "subtotal_usd",
            "tax_usd",
            "total_usd",
            "total_khr",
            "amount_paid_usd",
            "balance_due_usd",
            "status",
            "days_overdue",
        ],
        bill_rows,
    )
    insert_many(
        "fact_payments",
        ["payment_id", "date_key", "direction", "party_type", "party_id", "method", "amount_usd", "reference"],
        payment_rows,
    )
    insert_many(
        "fact_bank_transactions",
        ["txn_id", "date_key", "bank_account", "direction", "category", "amount_usd", "running_balance_usd"],
        bank_transaction_rows,
    )
    insert_many(
        "fact_monthly_financials",
        [
            "month_key",
            "revenue_usd",
            "cogs_usd",
            "gross_profit_usd",
            "opex_usd",
            "ebitda_usd",
            "net_profit_usd",
            "cash_balance_usd",
            "ar_balance_usd",
            "ap_balance_usd",
            "budget_revenue_usd",
            "budget_opex_usd",
        ],
        monthly_financial_rows,
    )


def default_accounting_duckdb_path() -> str:
    module_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(module_dir, "duckdb", "accounting.duckdb")


def generate_accounting_sample_data(
    output_path: str | None = None,
    csv_dir: str | None = None,
    force: bool = False,
) -> str:
    target = output_path or default_accounting_duckdb_path()
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)

    if os.path.isfile(target) and not force and os.path.getsize(target) > 0:
        return target

    if os.path.isfile(target):
        os.remove(target)

    conn = duckdb.connect(target)
    try:
        _create_accounting(conn)
        export_dir = csv_dir or os.path.join(os.path.dirname(os.path.abspath(target)), "accounting_csv")
        os.makedirs(export_dir, exist_ok=True)
        catalog_name = conn.execute("SELECT current_database()").fetchone()[0]
        schema_sql = f'"{catalog_name}"."accounting"'
        tables = [
            row[0]
            for row in conn.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'accounting'
                ORDER BY table_name
                """
            ).fetchall()
        ]
        for table in tables:
            csv_path = os.path.join(export_dir, f"{table}.csv")
            conn.execute(
                f"COPY {schema_sql}.{table} TO ? (HEADER, DELIMITER ',')",
                [csv_path],
            )
    finally:
        conn.close()

    return target


DOMAIN_BUILDERS: List[Callable[[duckdb.DuckDBPyConnection], None]] = [
    _create_banking,
    _create_insurance,
    _create_education,
    _create_energy,
    _create_govt,
    _create_ecommerce,
    _create_retail_supply_chain,
    _create_telecom,
    _create_healthcare,
    _create_saas,
    _create_ngo_impact,
    _create_hospitality,
    _create_accounting
]


def default_sample_duckdb_path() -> str:
    """Return the on-disk path for the shared sample DuckDB file.

    A single canonical, bundled location — generated at image build time
    (see Dockerfile.prod/.dev) so it always matches the pinned `duckdb`
    version. SAMPLE_DATA_DUCKDB_PATH can override this for local/ops needs.
    """
    env_path = os.getenv("SAMPLE_DATA_DUCKDB_PATH", "").strip()
    if env_path:
        return env_path

    module_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(module_dir, "duckdb", "sample_data.duckdb")


def resolve_sample_duckdb_path() -> str | None:
    path = default_sample_duckdb_path()
    return path if os.path.isfile(path) else None


def generate_sample_duckdb(output_path: str | None = None, force: bool = False) -> str:
    target = output_path or default_sample_duckdb_path()
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)

    if os.path.isfile(target) and not force and os.path.getsize(target) > 0:
        return target

    if os.path.isfile(target):
        os.remove(target)

    random.seed(SEED)
    conn = duckdb.connect(target)
    try:
        for builder in DOMAIN_BUILDERS:
            builder(conn)
    finally:
        conn.close()

    return target
