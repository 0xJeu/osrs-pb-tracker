import { neon } from '@neondatabase/serverless';

export type DatabaseRole = 'destructive-test' | 'seeded-staging';

type NeonIdentityRow = {
  projectId: string | null;
  branchId: string | null;
};

/**
 * Refuses destructive tests and staging-only utilities unless both their
 * declared purpose and Neon's server-reported identity match configuration.
 * This keeps a stale or incorrectly replaced DATABASE_URL from targeting the
 * production project.
 */
export async function assertDatabaseTarget(expectedRole: DatabaseRole): Promise<void> {
  const configuredRole = process.env.PB_TRACKER_DATABASE_ROLE;
  const expectedProjectId = process.env.PB_TRACKER_EXPECTED_PROJECT_ID;
  const expectedBranchId = process.env.PB_TRACKER_EXPECTED_BRANCH_ID;
  const connectionString = process.env.DATABASE_URL;

  if (configuredRole !== expectedRole) {
    throw new Error(
      `Database safety check failed: expected PB_TRACKER_DATABASE_ROLE=${expectedRole}`
    );
  }
  if (!expectedProjectId || !expectedBranchId) {
    throw new Error(
      'Database safety check failed: expected Neon project and branch IDs are required'
    );
  }
  if (!connectionString) {
    throw new Error('Database safety check failed: DATABASE_URL is required');
  }

  const sql = neon(connectionString);
  const rows = (await sql`
    SELECT
      current_setting('neon.project_id', true) AS "projectId",
      current_setting('neon.branch_id', true) AS "branchId"
  `) as NeonIdentityRow[];
  const identity = rows[0];

  if (
    identity?.projectId !== expectedProjectId ||
    identity?.branchId !== expectedBranchId
  ) {
    throw new Error(
      'Database safety check failed: DATABASE_URL does not match the configured Neon target'
    );
  }
}
