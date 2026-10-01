import { expect, test, type Page } from '@playwright/test';

// Step 3 -> 4 lands Bronze for real (an ingest_only sync job); stub that job.
async function mockBronzeLanding(page: Page) {
  await page.route('**/sync/trigger**', (route) =>
    route.fulfill({
      status: 202,
      json: {
        job_id: 'job-bronze',
        pipeline_id: 'pipe-e2e',
        status: 'queued',
        message: 'ok',
        mode: 'ingest_only',
        source_asset_id: 'ds-e2e',
      },
    })
  );
  await page.route('**/sync/job-bronze/status**', (route) =>
    route.fulfill({
      status: 200,
      json: {
        job_id: 'job-bronze',
        pipeline_id: 'pipe-e2e',
        status: 'succeeded',
        progress_pct: 100,
        rows_read: 0,
        rows_written: 0,
        mode: 'ingest_only',
        streams: [],
      },
    })
  );
}

async function landBronzeAndContinue(page: Page) {
  await page.getByRole('button', { name: 'Land Bronze & Continue' }).click();
  await expect(page.getByText('Bronze landed')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue to Transformation' }).click();
}

test.describe('Medallion Data Pipeline & 5-Step Wizard E2E', () => {
  test('navigates to /pipelines, verifies scrollable container, and opens new wizard', async ({ page }) => {
    await page.goto('/pipelines', { waitUntil: 'domcontentloaded' });

    // Verify page title and header
    await expect(page.getByRole('heading', { level: 4 })).toBeVisible();

    // Verify scrollable layout shell
    const scrollContainer = page.locator('.pipelines-list-page, .page-wrapper').first();
    await expect(scrollContainer).toBeVisible();

    // Click "New Pipeline" button
    const newPipelineBtn = page.locator('.pipelines-list-page, .page-wrapper').getByRole('button', { name: /new pipeline/i });
    await expect(newPipelineBtn).toBeVisible();
    await newPipelineBtn.click();

    // Expect navigation to /pipelines/new
    await page.waitForURL('**/pipelines/new', { waitUntil: 'domcontentloaded' });
  });

  test('walks through the 5-step wizard with destination, dbt transform, and semantic layer', async ({
    page,
  }) => {
    // Intercept catalog discovery to provide streams for the 5-step wizard flow
    await mockBronzeLanding(page);
    await page.route('**/connectors/discover**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          streams: [
            {
              name: 'customers',
              namespace: 'bronze',
              supported_sync_modes: ['full_refresh', 'incremental'],
              default_cursor_field: 'updated_at',
              primary_key: ['id'],
              columns: [
                { name: 'id', type: 'VARCHAR', is_primary_key: true, is_cursor: false },
                { name: 'email', type: 'VARCHAR', is_primary_key: false, is_cursor: false },
                { name: 'amount', type: 'NUMERIC', is_primary_key: false, is_cursor: false },
                { name: 'updated_at', type: 'TIMESTAMP', is_primary_key: false, is_cursor: true },
              ],
            },
          ],
          total_streams: 1,
        }),
      });
    });

    await page.goto('/pipelines/new', { waitUntil: 'domcontentloaded' });

    // 1. Verify Wizard Header and Steps
    await expect(page.getByRole('heading', { name: 'New Data Pipeline' })).toBeVisible();

    const stepsContainer = page.locator('.ant-steps');
    await expect(stepsContainer).toBeVisible();
    await expect(stepsContainer.getByText('Source')).toBeVisible();
    await expect(stepsContainer.getByText('Destination')).toBeVisible();
    await expect(stepsContainer.getByText('Sync & Schedule')).toBeVisible();
    await expect(stepsContainer.getByText('Transformation')).toBeVisible();
    await expect(stepsContainer.getByText('Semantic Layer')).toBeVisible();

    // Verify page shell is scrollable
    const pageShell = page.locator('.pipelines-new-page');
    await expect(pageShell).toBeVisible();

    // 2. Step 1: Source
    await expect(page.getByRole('heading', { name: 'Choose Source' })).toBeVisible();

    // Click "Continue to Destination"
    const toDestinationBtn = page.getByRole('button', { name: 'Continue to Destination' });
    await expect(toDestinationBtn).toBeVisible();
    await toDestinationBtn.click();

    // 3. Step 2: Destination
    await expect(page.getByRole('heading', { name: 'Select Storage Destination' })).toBeVisible();
    await expect(page.getByText('S3 Lakehouse', { exact: true })).toBeVisible();
    await expect(page.getByText('Storage & Security Configuration')).toBeVisible();
    await expect(page.getByText('Encrypted at rest (AES-256)')).toBeVisible();

    // Click "Discover Catalog & Next"
    const toScheduleBtn = page.getByRole('button', { name: 'Discover Catalog & Next' });
    await expect(toScheduleBtn).toBeVisible();
    await toScheduleBtn.click();

    // 4. Step 3: Sync & Schedule
    await expect(page.getByText('Select Streams & Sync Cadence')).toBeVisible();
    await expect(page.getByText('Pipeline Identifier')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Postgres to Gold Semantic Layer')).toBeVisible();

    // Land Bronze for real, then continue to Transformation
    await landBronzeAndContinue(page);

    // 5. Step 4: Transformation (dbt)
    await expect(page.getByRole('heading', { name: 'Transformation & Data Quality' })).toBeVisible();
    await expect(page.getByText('Auto-Mask Sensitive Data (PII)')).toBeVisible();
    await expect(page.getByText('Quarantine Corrupted Rows')).toBeVisible();

    // Test Dry-run preview simulation
    const dryRunBtn = page.getByRole('button', { name: 'Simulate 5-Row Dry Run' });
    await expect(dryRunBtn).toBeVisible();
    await dryRunBtn.click();

    // Expect Bronze vs Silver split preview
    await expect(page.getByText('🥉 Bronze (Raw Input)')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('🥈 Silver (Cleaned Delta Output)')).toBeVisible();

    // Click "Continue to Semantic Layer"
    const toSemanticBtn = page.getByRole('button', { name: 'Continue to Semantic Layer' });
    await expect(toSemanticBtn).toBeVisible();
    await toSemanticBtn.click();

    // 6. Step 5: Semantic Layer (MetricFlow)
    await expect(page.getByRole('heading', { name: 'Aicser Semantic Layer' })).toBeVisible();
    await expect(page.getByText('Hallucination-Proof AI Analytics')).toBeVisible();

    // Test AI Prompt Context Preview toggle
    const promptPreviewBtn = page.getByRole('button', { name: /Preview Prompt Context/i });
    await expect(promptPreviewBtn).toBeVisible();
    await promptPreviewBtn.click();

    await expect(page.getByText('### Available Semantic Metrics:').first()).toBeVisible();

    // Verify Final Summary and Deploy CTA
    await expect(page.getByText('Pipeline Summary & Ingestion Blueprint')).toBeVisible();
    const deployBtn = page.getByRole('button', { name: 'Deploy & Trigger Pipeline' });
    await expect(deployBtn).toBeVisible();
  });

  test('verifies dynamic measures update on table switch and interactive workbook in transformation', async ({
    page,
  }) => {
    // Intercept catalog discovery with multi-table schema (deals, departments, customers)
    await mockBronzeLanding(page);
    await page.route('**/connectors/discover**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          streams: [
            {
              name: 'deals',
              namespace: 'bronze',
              supported_sync_modes: ['full_refresh', 'incremental'],
              default_cursor_field: 'created_at',
              primary_key: ['id'],
              columns: [
                { name: 'id', type: 'VARCHAR', is_primary_key: true, is_cursor: false },
                { name: 'amount', type: 'NUMERIC', is_primary_key: false, is_cursor: false },
                { name: 'department_id', type: 'INTEGER', is_primary_key: false, is_cursor: false },
                { name: 'customer_id', type: 'VARCHAR', is_primary_key: false, is_cursor: false },
                { name: 'created_at', type: 'TIMESTAMP', is_primary_key: false, is_cursor: true },
              ],
            },
            {
              name: 'departments',
              namespace: 'bronze',
              supported_sync_modes: ['full_refresh'],
              primary_key: ['id'],
              columns: [
                { name: 'id', type: 'INTEGER', is_primary_key: true, is_cursor: false },
                { name: 'name', type: 'VARCHAR', is_primary_key: false, is_cursor: false },
              ],
            },
            {
              name: 'customers',
              namespace: 'bronze',
              supported_sync_modes: ['full_refresh'],
              primary_key: ['id'],
              columns: [
                { name: 'id', type: 'VARCHAR', is_primary_key: true, is_cursor: false },
                { name: 'name', type: 'VARCHAR', is_primary_key: false, is_cursor: false },
                { name: 'email', type: 'VARCHAR', is_primary_key: false, is_cursor: false },
              ],
            },
          ],
          total_streams: 3,
        }),
      });
    });

    await page.goto('/pipelines/new', { waitUntil: 'domcontentloaded' });

    // Step 1 -> Step 2
    await page.getByRole('button', { name: 'Continue to Destination' }).click();

    // Step 2 -> Step 3
    await page.getByRole('button', { name: 'Discover Catalog & Next' }).click();

    // Step 3 -> Step 4
    await expect(page.getByText('Select Streams & Sync Cadence')).toBeVisible();
    await landBronzeAndContinue(page);

    // Step 4: Verify Visual Data Cleaning Workbook
    await expect(page.getByText('Visual Data Cleaning Workbook')).toBeVisible();
    await expect(page.getByText('Silver Cleansed Table (Live Preview)')).toBeVisible();

    // Verify stream tabs exist
    await expect(page.getByRole('tab', { name: /deals/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /departments/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /customers/i })).toBeVisible();

    // Step 4 -> Step 5: Semantic Layer
    await page.getByRole('button', { name: 'Continue to Semantic Layer' }).click();
    await expect(page.getByRole('heading', { name: 'Aicser Semantic Layer' })).toBeVisible();

    // Check fact table is initially deals (candidate fact table)
    await expect(page.getByRole('strong').filter({ hasText: 'fact_deals' })).toBeVisible();
    // Verify deals has SUM(amount) measure
    await expect(page.getByText('SUM(amount)').first()).toBeVisible();

    // Switch Universal Fact Table to departments
    const factSelect = page.locator('.ant-select').filter({ hasText: /fact_/ }).first();
    await factSelect.click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: 'fact_departments' }).click();

    // Verify that departments does NOT show SUM(amount) and shows Total Departments Records
    await expect(page.getByRole('strong').filter({ hasText: 'fact_departments' })).toBeVisible();
    await expect(page.getByText('Total Departments Records')).toBeVisible();
    await expect(page.getByText('SUM(amount)')).not.toBeVisible();
  });

  test('verifies workbook pagination controls, page navigation, and row limit change', async ({ page }) => {
    // Intercept catalog discovery
    await mockBronzeLanding(page);
    await page.route('**/connectors/discover**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          streams: [
            {
              name: 'deals',
              namespace: 'bronze',
              supported_sync_modes: ['full_refresh'],
              primary_key: ['id'],
              columns: [
                { name: 'id', type: 'VARCHAR', is_primary_key: true, is_cursor: false },
                { name: 'price', type: 'NUMERIC', is_primary_key: false, is_cursor: false },
                { name: 'stock_quantity', type: 'INTEGER', is_primary_key: false, is_cursor: false },
              ],
            },
          ],
          total_streams: 1,
        }),
      });
    });

    await page.goto('/pipelines/new', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue to Destination' }).click();
    await page.getByRole('button', { name: 'Discover Catalog & Next' }).click();
    await landBronzeAndContinue(page);

    // Verify initial pagination state
    await expect(page.getByText('Visual Data Cleaning Workbook')).toBeVisible();
    await expect(page.getByText(/Page 1 of/i)).toBeVisible();

    // Verify Next Page button and click it
    const nextBtn = page.getByRole('button', { name: 'Next Page' });
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();
    await expect(page.getByText(/Page 2 of/i)).toBeVisible();

    // Click Previous Page button
    const prevBtn = page.getByRole('button', { name: 'Previous Page' });
    await expect(prevBtn).toBeVisible();
    await prevBtn.click();
    await expect(page.getByText(/Page 1 of/i)).toBeVisible();

    // Continue to Semantic Layer and verify the Metrics Workbook + YAML model editor
    await page.getByRole('button', { name: 'Continue to Semantic Layer' }).click();
    await expect(page.getByRole('heading', { name: 'Aicser Semantic Layer' })).toBeVisible();

    await expect(page.getByRole('tab', { name: /Cube Data Slice/i })).toHaveCount(0);
    const workbookTab = page.getByRole('tab', { name: /Metrics Workbook/i });
    await workbookTab.click();
    await expect(page.getByRole('grid')).toBeVisible();

    await page.getByText('Model YAML').click();
    await expect(page.getByText(/models\/semantic\/.+\.yml/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply to workbook' })).toBeDisabled();
  });
});
