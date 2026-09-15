export interface ColumnProfile {
  name: string;
  type: string;
  nullable: boolean;
  isPk?: boolean;
  isMetric?: boolean;
  stats: {
    distinctCount: number;
    nullCount: number;
    nullPercent: number;
    validPercent: number;
    invalidPercent: number;
    min?: string | number;
    max?: string | number;
    mean?: number;
    distribution: { label: string; count: number; percent: number }[];
  };
}

export interface PipelineNodeData {
  id: string;
  name: string;
  type: 'source' | 'source_group' | 'bronze' | 'quality' | 'silver' | 'transform' | 'gold' | 'destination';
  layerLabel: string;
  tag: string;
  accentColor: string;
  iconType: string;
  status: 'active' | 'success' | 'warning' | 'error' | 'running';
  rowCount: number;
  duration?: string;
  tablesCount?: number;
  tablesList?: string[];
  details: {
    format?: string;
    engine?: string;
    mode?: string;
    schedule?: string;
    watermark?: string;
    primaryKey?: string[];
    rulesCount?: number;
    quarantineCount?: number;
    targetDestination?: string;
    description: string;
    schemaEvolution?: 'auto_propagate' | 'pause_on_drift' | 'ignore';
    syncFrequency?: string;
  };
  schema: ColumnProfile[];
  sampleRows: Record<string, any>[];
  quarantineRows?: Record<string, any>[];
}

export const MOCK_MULTI_TABLE_STREAMS = [
  {
    table: 'orders',
    schema: 'public',
    mode: 'Incremental Watermark',
    cursor: 'updated_at',
    primaryKey: 'order_id',
    records: 48520,
    status: 'healthy',
    selected: true,
  },
  {
    table: 'customers',
    schema: 'public',
    mode: 'Incremental Watermark',
    cursor: 'updated_at',
    primaryKey: 'customer_id',
    records: 12450,
    status: 'healthy',
    selected: true,
  },
  {
    table: 'payments',
    schema: 'public',
    mode: 'Append Log (CDC)',
    cursor: 'transaction_id',
    primaryKey: 'payment_id',
    records: 52100,
    status: 'healthy',
    selected: true,
  },
  {
    table: 'products',
    schema: 'public',
    mode: 'Full Refresh Snapshot',
    cursor: 'N/A',
    primaryKey: 'product_id',
    records: 840,
    status: 'healthy',
    selected: true,
  },
  {
    table: 'audit_logs',
    schema: 'system',
    mode: 'Excluded',
    cursor: 'log_time',
    primaryKey: 'id',
    records: 1200400,
    status: 'disabled',
    selected: false,
  },
];

export const MOCK_PIPELINE_NODES: Record<string, PipelineNodeData> = {
  'source-postgres-group': {
    id: 'source-postgres-group',
    name: 'PostgreSQL RDS Prod (4 Tables)',
    type: 'source_group',
    layerLabel: 'Data Source Cluster',
    tag: 'RDBMS Multi-Table',
    accentColor: '#3b82f6',
    iconType: 'database',
    status: 'active',
    rowCount: 113910,
    duration: '1.4s',
    tablesCount: 4,
    tablesList: ['orders', 'customers', 'payments', 'products'],
    details: {
      engine: 'PostgreSQL 16 Engine (RDS us-east-1)',
      mode: 'Multi-Stream (3 Incremental, 1 Snapshot)',
      schedule: 'Every 15 Minutes (*/15 * * * *)',
      syncFrequency: 'Every 15m',
      schemaEvolution: 'auto_propagate',
      description: 'Production operational database introspecting 4 active replicated tables.',
    },
    schema: [
      {
        name: 'order_id',
        type: 'VARCHAR(64)',
        nullable: false,
        isPk: true,
        stats: {
          distinctCount: 48520,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          distribution: [
            { label: 'ord_10*', count: 12000, percent: 25 },
            { label: 'ord_20*', count: 14000, percent: 29 },
            { label: 'ord_30*', count: 13520, percent: 28 },
            { label: 'ord_40*', count: 9000, percent: 18 },
          ],
        },
      },
      {
        name: 'customer_id',
        type: 'VARCHAR(64)',
        nullable: false,
        stats: {
          distinctCount: 12450,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          distribution: [
            { label: 'Enterprise', count: 1450, percent: 12 },
            { label: 'Growth', count: 4800, percent: 38 },
            { label: 'Starter', count: 6200, percent: 50 },
          ],
        },
      },
      {
        name: 'total_amount',
        type: 'VARCHAR',
        nullable: true,
        stats: {
          distinctCount: 3840,
          nullCount: 24,
          nullPercent: 0.05,
          validPercent: 99.9,
          invalidPercent: 0.05,
          min: '-$50.00',
          max: '$4,990.00',
          mean: 840.5,
          distribution: [
            { label: '< $100', count: 8200, percent: 17 },
            { label: '$100-$500', count: 24100, percent: 50 },
            { label: '$500-$2000', count: 12400, percent: 26 },
            { label: '> $2000', count: 3820, percent: 7 },
          ],
        },
      },
      {
        name: 'currency',
        type: 'VARCHAR(3)',
        nullable: false,
        stats: {
          distinctCount: 3,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          distribution: [
            { label: 'USD', count: 41200, percent: 85 },
            { label: 'EUR', count: 5200, percent: 11 },
            { label: 'GBP', count: 2120, percent: 4 },
          ],
        },
      },
      {
        name: 'status',
        type: 'VARCHAR(32)',
        nullable: false,
        stats: {
          distinctCount: 4,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          distribution: [
            { label: 'completed', count: 44200, percent: 91 },
            { label: 'pending', count: 3100, percent: 6 },
            { label: 'refunded', count: 920, percent: 2 },
            { label: 'failed', count: 300, percent: 1 },
          ],
        },
      },
      {
        name: 'created_at',
        type: 'TIMESTAMPTZ',
        nullable: false,
        stats: {
          distinctCount: 48100,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          min: '2026-08-01',
          max: '2026-09-11',
          distribution: [
            { label: 'Aug 2026', count: 24000, percent: 49 },
            { label: 'Sep 2026', count: 24520, percent: 51 },
          ],
        },
      },
    ],
    sampleRows: [
      { order_id: 'ord_101', customer_id: 'cust_882', total_amount: '$1,250.00', currency: 'USD', status: 'completed', created_at: '2026-09-11 08:30:00' },
      { order_id: 'ord_102', customer_id: 'cust_419', total_amount: '$480.50', currency: 'USD', status: 'completed', created_at: '2026-09-11 08:45:10' },
      { order_id: 'ord_103', customer_id: 'cust_110', total_amount: '-$50.00', currency: 'USD', status: 'refunded', created_at: '2026-09-11 09:12:00' },
      { order_id: 'ord_104', customer_id: 'cust_773', total_amount: '$2,990.00', currency: 'USD', status: 'completed', created_at: '2026-09-11 09:40:00' },
      { order_id: 'ord_105', customer_id: 'cust_901', total_amount: null, currency: 'USD', status: 'pending', created_at: '2026-09-11 10:05:00' },
      { order_id: 'ord_106', customer_id: 'cust_342', total_amount: '$149.00', currency: 'USD', status: 'completed', created_at: '2026-09-11 10:12:00' },
      { order_id: 'ord_107', customer_id: 'cust_551', total_amount: '$720.00', currency: 'EUR', status: 'completed', created_at: '2026-09-11 10:18:00' },
    ],
  },

  'source-stripe': {
    id: 'source-stripe',
    name: 'Stripe Billing API',
    type: 'source',
    layerLabel: 'Cloud API Source',
    tag: 'REST / Webhook',
    accentColor: '#6366f1',
    iconType: 'cloud',
    status: 'active',
    rowCount: 52100,
    duration: '0.6s',
    details: {
      engine: 'Stripe OAuth Connector',
      mode: 'Continuous Webhook Append',
      schedule: 'Real-time Event Stream',
      description: 'Captures global credit card fees, payout schedules, and disputes.',
    },
    schema: [
      {
        name: 'charge_id',
        type: 'VARCHAR(64)',
        nullable: false,
        isPk: true,
        stats: { distinctCount: 52100, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'order_id',
        type: 'VARCHAR(64)',
        nullable: false,
        stats: { distinctCount: 48520, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'stripe_fee',
        type: 'DECIMAL(8,2)',
        nullable: false,
        stats: { distinctCount: 420, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'payout_status',
        type: 'VARCHAR(32)',
        nullable: false,
        stats: { distinctCount: 2, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
    ],
    sampleRows: [
      { charge_id: 'ch_881', order_id: 'ord_101', stripe_fee: 36.25, payout_status: 'paid' },
      { charge_id: 'ch_882', order_id: 'ord_102', stripe_fee: 14.15, payout_status: 'paid' },
      { charge_id: 'ch_883', order_id: 'ord_104', stripe_fee: 87.00, payout_status: 'paid' },
      { charge_id: 'ch_884', order_id: 'ord_106', stripe_fee: 4.60, payout_status: 'paid' },
    ],
  },

  'bronze-raw': {
    id: 'bronze-raw',
    name: 'Bronze Lake Raw (4 Tables)',
    type: 'bronze',
    layerLabel: 'Bronze Medallion',
    tag: 'Raw Parquet S3',
    accentColor: '#ea580c',
    iconType: 'box',
    status: 'success',
    rowCount: 113910,
    duration: '1.2s',
    details: {
      format: 'Parquet (ZSTD Compressed)',
      engine: 'DuckDB Engine (In-Memory Microbatch)',
      mode: 'Append-Only Historical Landing',
      primaryKey: ['order_id', '_load_id'],
      description: 'Immutable historical audit landing partitioned by load_id and table_name.',
    },
    schema: [
      {
        name: 'order_id',
        type: 'VARCHAR',
        nullable: false,
        isPk: true,
        stats: { distinctCount: 48520, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'customer_id',
        type: 'VARCHAR',
        nullable: false,
        stats: { distinctCount: 12450, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'total_amount',
        type: 'VARCHAR',
        nullable: true,
        stats: { distinctCount: 3840, nullCount: 24, nullPercent: 0.05, validPercent: 99.9, invalidPercent: 0.05, distribution: [] },
      },
      {
        name: '_load_id',
        type: 'UUID',
        nullable: false,
        stats: { distinctCount: 12, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: '_ingest_time',
        type: 'TIMESTAMPTZ',
        nullable: false,
        stats: { distinctCount: 12, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
    ],
    sampleRows: [
      { order_id: 'ord_101', customer_id: 'cust_882', total_amount: '$1,250.00', _load_id: 'a9f1b2-01', _ingest_time: '2026-09-11 10:15:00' },
      { order_id: 'ord_102', customer_id: 'cust_419', total_amount: '$480.50', _load_id: 'a9f1b2-01', _ingest_time: '2026-09-11 10:15:00' },
      { order_id: 'ord_103', customer_id: 'cust_110', total_amount: '-$50.00', _load_id: 'a9f1b2-01', _ingest_time: '2026-09-11 10:15:00' },
      { order_id: 'ord_104', customer_id: 'cust_773', total_amount: '$2,990.00', _load_id: 'a9f1b2-01', _ingest_time: '2026-09-11 10:15:00' },
      { order_id: 'ord_105', customer_id: 'cust_901', total_amount: null, _load_id: 'a9f1b2-01', _ingest_time: '2026-09-11 10:15:00' },
    ],
  },

  'quality-gate': {
    id: 'quality-gate',
    name: 'Expectations & Contract Gate',
    type: 'quality',
    layerLabel: 'Data Quality & Contract',
    tag: 'Great Expectations',
    accentColor: '#10b981',
    iconType: 'safety',
    status: 'warning',
    rowCount: 48498,
    duration: '0.35s',
    details: {
      rulesCount: 6,
      quarantineCount: 22,
      mode: 'Warn / Quarantine / Halt',
      description: 'Enforces business contracts, PII scrubbing, and validation rules before Silver.',
    },
    schema: [
      {
        name: 'rule_name',
        type: 'VARCHAR',
        nullable: false,
        stats: { distinctCount: 4, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'target_column',
        type: 'VARCHAR',
        nullable: false,
        stats: { distinctCount: 4, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'pass_rate',
        type: 'FLOAT',
        nullable: false,
        stats: { distinctCount: 4, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
    ],
    sampleRows: [
      { rule_name: 'pk_uniqueness', target_column: 'order_id', constraint: 'COUNT(*) OVER == 1', action: 'HALT', pass_rate: '100.0%' },
      { rule_name: 'positive_amount', target_column: 'total_amount', constraint: 'amount >= 0', action: 'QUARANTINE', pass_rate: '99.85%' },
      { rule_name: 'not_null_customer', target_column: 'customer_id', constraint: 'IS NOT NULL', action: 'HALT', pass_rate: '100.0%' },
      { rule_name: 'valid_status', target_column: 'status', constraint: 'IN (completed, pending, refunded)', action: 'WARN', pass_rate: '99.96%' },
    ],
    quarantineRows: [
      { order_id: 'ord_103', customer_id: 'cust_110', total_amount: '-$50.00', _quarantine_reason: 'negative_total_amount', captured_at: '2026-09-11 10:15:02' },
      { order_id: 'ord_105', customer_id: 'cust_901', total_amount: null, _quarantine_reason: 'null_amount_pending', captured_at: '2026-09-11 10:15:02' },
    ],
  },

  'silver-cleaned': {
    id: 'silver-cleaned',
    name: 'silver_conformed_crm',
    type: 'silver',
    layerLabel: 'Silver Medallion (Conformed)',
    tag: 'Apache Iceberg v2',
    accentColor: '#0284c7',
    iconType: 'table',
    status: 'success',
    rowCount: 48498,
    duration: '1.6s',
    details: {
      format: 'Apache Iceberg v2 (Polaris Catalog)',
      engine: 'DuckDB + PyIceberg REST',
      mode: 'Merge Deduplication (Upsert on order_id)',
      primaryKey: ['order_id'],
      description: 'Multi-table join (Orders + Customers + Payments) cleaned, typed, and normalized.',
    },
    schema: [
      {
        name: 'order_id',
        type: 'VARCHAR(64)',
        nullable: false,
        isPk: true,
        stats: {
          distinctCount: 48498,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          distribution: [
            { label: 'ord_10*', count: 12000, percent: 25 },
            { label: 'ord_20*', count: 14000, percent: 29 },
            { label: 'ord_30*', count: 13520, percent: 28 },
            { label: 'ord_40*', count: 8978, percent: 18 },
          ],
        },
      },
      {
        name: 'customer_name',
        type: 'VARCHAR(128)',
        nullable: false,
        stats: {
          distinctCount: 12450,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          distribution: [
            { label: 'Acme Corp', count: 120, percent: 1 },
            { label: 'Globex Inc', count: 95, percent: 0.8 },
            { label: 'Initech', count: 88, percent: 0.7 },
            { label: 'Others', count: 48195, percent: 97.5 },
          ],
        },
      },
      {
        name: 'amount_usd',
        type: 'DECIMAL(12,2)',
        nullable: false,
        stats: {
          distinctCount: 3820,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          min: 15.00,
          max: 4990.00,
          mean: 842.1,
          distribution: [
            { label: '< $100', count: 8180, percent: 17 },
            { label: '$100-$500', count: 24100, percent: 50 },
            { label: '$500-$2000', count: 12400, percent: 26 },
            { label: '> $2000', count: 3818, percent: 7 },
          ],
        },
      },
      {
        name: 'net_revenue_usd',
        type: 'DECIMAL(12,2)',
        nullable: false,
        stats: {
          distinctCount: 3820,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          min: 14.10,
          max: 4903.00,
          mean: 815.3,
          distribution: [
            { label: '< $100', count: 8180, percent: 17 },
            { label: '$100-$500', count: 24100, percent: 50 },
            { label: '$500-$2000', count: 12400, percent: 26 },
            { label: '> $2000', count: 3818, percent: 7 },
          ],
        },
      },
      {
        name: 'order_date',
        type: 'DATE',
        nullable: false,
        stats: {
          distinctCount: 42,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          min: '2026-08-01',
          max: '2026-09-11',
          distribution: [
            { label: 'Week 34', count: 11200, percent: 23 },
            { label: 'Week 35', count: 12800, percent: 26 },
            { label: 'Week 36', count: 14200, percent: 29 },
            { label: 'Week 37', count: 10298, percent: 22 },
          ],
        },
      },
      {
        name: 'customer_tier',
        type: 'VARCHAR(16)',
        nullable: false,
        stats: {
          distinctCount: 3,
          nullCount: 0,
          nullPercent: 0,
          validPercent: 100,
          invalidPercent: 0,
          distribution: [
            { label: 'Enterprise', count: 1450, percent: 12 },
            { label: 'Growth', count: 4800, percent: 38 },
            { label: 'Starter', count: 6200, percent: 50 },
          ],
        },
      },
    ],
    sampleRows: [
      { order_id: 'ord_101', customer_name: 'Acme Corp', amount_usd: 1250.00, net_revenue_usd: 1213.75, order_date: '2026-09-11', customer_tier: 'Enterprise' },
      { order_id: 'ord_102', customer_name: 'Globex Inc', amount_usd: 480.50, net_revenue_usd: 466.35, order_date: '2026-09-11', customer_tier: 'Growth' },
      { order_id: 'ord_104', customer_name: 'Initech Systems', amount_usd: 2990.00, net_revenue_usd: 2903.00, order_date: '2026-09-11', customer_tier: 'Enterprise' },
      { order_id: 'ord_106', customer_name: 'Hooli Labs', amount_usd: 149.00, net_revenue_usd: 144.40, order_date: '2026-09-11', customer_tier: 'Starter' },
      { order_id: 'ord_107', customer_name: 'Pied Piper EU', amount_usd: 785.00, net_revenue_usd: 762.50, order_date: '2026-09-11', customer_tier: 'Growth' },
    ],
  },

  'gold-mrr': {
    id: 'gold-mrr',
    name: 'gold_financial_marts',
    type: 'gold',
    layerLabel: 'Gold Medallion (Marts)',
    tag: 'Star Schema Cube',
    accentColor: '#eab308',
    iconType: 'crown',
    status: 'success',
    rowCount: 360,
    duration: '0.85s',
    details: {
      format: 'Apache Iceberg Star Schema (Polaris)',
      mode: 'Merge Aggregate (Upsert on month+tier)',
      primaryKey: ['order_month', 'customer_tier'],
      description: 'Curated financial mart with verified semantic metrics powering GenBI AI agents.',
    },
    schema: [
      {
        name: 'order_month',
        type: 'VARCHAR(7)',
        nullable: false,
        isPk: true,
        stats: { distinctCount: 12, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'customer_tier',
        type: 'VARCHAR(16)',
        nullable: false,
        isPk: true,
        stats: { distinctCount: 3, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'total_mrr',
        type: 'DECIMAL(14,2)',
        nullable: false,
        isMetric: true,
        stats: { distinctCount: 360, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'paid_orders_count',
        type: 'BIGINT',
        nullable: false,
        isMetric: true,
        stats: { distinctCount: 280, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
      {
        name: 'avg_order_value',
        type: 'DECIMAL(10,2)',
        nullable: false,
        isMetric: true,
        stats: { distinctCount: 360, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] },
      },
    ],
    sampleRows: [
      { order_month: '2026-09', customer_tier: 'Enterprise', total_mrr: 4240.00, paid_orders_count: 2, avg_order_value: 2120.00 },
      { order_month: '2026-09', customer_tier: 'Growth', total_mrr: 480.50, paid_orders_count: 1, avg_order_value: 480.50 },
      { order_month: '2026-09', customer_tier: 'Starter', total_mrr: 149.00, paid_orders_count: 1, avg_order_value: 149.00 },
      { order_month: '2026-08', customer_tier: 'Enterprise', total_mrr: 3890.00, paid_orders_count: 2, avg_order_value: 1945.00 },
      { order_month: '2026-08', customer_tier: 'Growth', total_mrr: 610.00, paid_orders_count: 2, avg_order_value: 305.00 },
    ],
  },

  'dest-snowflake': {
    id: 'dest-snowflake',
    name: 'Snowflake Enterprise DW',
    type: 'destination',
    layerLabel: 'Reverse-ETL Destination',
    tag: 'Cloud DWH',
    accentColor: '#38bdf8',
    iconType: 'cloud',
    status: 'active',
    rowCount: 360,
    details: {
      targetDestination: 'ANALYTICS.FINANCE.MRR_SUMMARY',
      mode: 'Mirror / Fast Copy',
      schedule: 'Immediate post-Gold run',
      description: 'Synchronizes curated Gold aggregates into corporate Snowflake warehouse for enterprise BI.',
    },
    schema: [],
    sampleRows: [],
  },

  'dest-genbi': {
    id: 'dest-genbi',
    name: 'GenBI Autonomous Agent',
    type: 'destination',
    layerLabel: 'GenBI AI Grounding',
    tag: 'Semantic Contract',
    accentColor: '#8b5cf6',
    iconType: 'robot',
    status: 'active',
    rowCount: 360,
    details: {
      targetDestination: 'Aicser AI Semantic Grounding Vector Store',
      description: 'Exposes verified golden metrics, semantic descriptions, and prompt context to AI analyst.',
    },
    schema: [
      { name: 'metric_name', type: 'VARCHAR', nullable: false, stats: { distinctCount: 3, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] } },
      { name: 'formula', type: 'TEXT', nullable: false, stats: { distinctCount: 3, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] } },
      { name: 'verified_by', type: 'VARCHAR', nullable: false, stats: { distinctCount: 2, nullCount: 0, nullPercent: 0, validPercent: 100, invalidPercent: 0, distribution: [] } },
    ],
    sampleRows: [
      { metric_name: 'Total MRR', formula: 'SUM(total_mrr)', verified_by: 'DataEng Lead' },
      { metric_name: 'Avg Order Value (AOV)', formula: 'AVG(avg_order_value)', verified_by: 'Head of Finance' },
      { metric_name: 'Customer Velocity', formula: 'paid_orders_count / active_customers', verified_by: 'RevOps' },
    ],
  },
};

export const MOCK_YAML_DEFINITION = `# Aicser Universal Data Pipeline Specification (v2)
version: 2
pipeline:
  name: customer_revenue_gold
  slug: customer-revenue-gold
  description: "Enterprise Multi-Source Medallion ELT from Postgres & Stripe to Iceberg Gold with Reverse-ETL."
  schedule:
    cron: "*/15 * * * *"  # Every 15 minutes
    target_lag: "15m"
    timezone: "UTC"
  retry_policy:
    max_retries: 3
    backoff_seconds: 60

# 1. Multi-Table Source Ingestion (EL)
sources:
  - id: postgres_prod
    name: "RDS PostgreSQL Production"
    type: database
    connector: postgresql
    connection_id: "conn-prod-rds-01"
    schema_evolution: auto_propagate  # Options: auto_propagate | pause_on_drift | ignore
    concurrency_workers: 4            # Multi-table parallel extraction
    streams:
      - table: orders
        sync_mode: incremental
        watermark_column: updated_at
        primary_key: [order_id]
        exclude_columns: [internal_notes]
      - table: customers
        sync_mode: incremental
        watermark_column: updated_at
        primary_key: [customer_id]
      - table: payments
        sync_mode: cdc_log
        primary_key: [payment_id]
      - table: products
        sync_mode: full_refresh_snapshot
        primary_key: [product_id]

  - id: stripe_api
    name: "Stripe Billing Events"
    type: api_stream
    connector: stripe
    streams:
      - endpoint: charges
        sync_mode: append_stream

# 2. Bronze Immutable Raw Landing
bronze:
  storage_prefix: "s3://aicser-lake/bronze/"
  format: parquet
  compression: zstd
  partition_by: [_load_id]
  audit_columns:
    - _load_id
    - _ingest_time
    - _source_stream

# 3. Data Quality & Expectations Gate
quality_gate:
  rules:
    - name: check_pk_uniqueness
      type: unique
      columns: [order_id]
      on_fail: fail
    - name: positive_order_amount
      type: expression
      expr: "total_amount >= 0"
      on_fail: quarantine
    - name: customer_required
      type: not_null
      columns: [customer_id]
      on_fail: fail
    - name: valid_status_codes
      type: accepted_values
      column: status
      values: [completed, pending, refunded]
      on_fail: warn
  quarantine:
    destination: "s3://aicser-lake/quarantine/orders/"
    notify: [slack_data_alerts, email_dataeng]

# 4. Silver Conformed Multi-Source Join
silver:
  table: silver_conformed_crm
  catalog: polaris
  namespace: finance_prod
  format: iceberg
  write_mode: merge
  primary_key: [order_id]
  partition_by: [order_date]
  transforms:
    - join:
        source: postgres_prod.orders
        join_with: postgres_prod.customers
        type: left
        on: { customer_id: customer_id }
    - join:
        join_with: stripe_api.charges
        type: left
        on: { order_id: order_id }
    - clean:
        columns: [total_amount]
        currency: true
        trim: true
    - cast:
        columns:
          amount_usd: "decimal(12,2)"
          stripe_fee: "decimal(8,2)"
    - derive:
        columns:
          net_revenue_usd: "amount_usd - COALESCE(stripe_fee, 0)"
          order_date: "CAST(created_at AS DATE)"
          order_month: "strftime(created_at, '%Y-%m')"
          customer_tier: "CASE WHEN amount_usd >= 1000 THEN 'Enterprise' WHEN amount_usd >= 300 THEN 'Growth' ELSE 'Starter' END"

# 5. Gold Star Schema Dimensional Marts
gold:
  table: gold_financial_marts
  catalog: polaris
  namespace: finance_prod
  format: iceberg
  write_mode: overwrite
  primary_key: [order_month, customer_tier]
  aggregation:
    group_by: [order_month, customer_tier]
    measures:
      - { name: total_mrr, expr: "SUM(net_revenue_usd)" }
      - { name: paid_orders_count, expr: "COUNT(order_id)" }
      - { name: avg_order_value, expr: "AVG(amount_usd)" }
      - { name: active_customers, expr: "COUNT(DISTINCT customer_id)" }

# 6. Egress & Reverse-ETL Destinations
destinations:
  - id: dest-snowflake
    name: "Corporate Snowflake DW"
    type: reverse_etl
    target_warehouse: "ANALYTICS"
    target_schema: "FINANCE"
    target_table: "MRR_SUMMARY"
    write_mode: mirror
    frequency: on_pipeline_completion

  - id: dest-genbi
    name: "Aicser GenBI Semantic Engine"
    type: ai_semantic_model
    certified: true
    dimensions: [order_month, customer_tier]
    metrics:
      - { name: "Total MRR", formula: "SUM(total_mrr)", verified: true }
      - { name: "AOV", formula: "AVG(avg_order_value)", verified: true }
`;
