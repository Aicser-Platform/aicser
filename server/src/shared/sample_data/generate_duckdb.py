"""
Generate the shared sample_data.duckdb file used by sample_duckdb data sources.

Each domain is a DuckDB schema with demo tables/columns aligned with dashboard
templates and domain_templates.
"""

from __future__ import annotations

import os
import random
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
