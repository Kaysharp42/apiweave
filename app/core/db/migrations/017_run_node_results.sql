-- One row per completed node of a run, instead of one `$.results` array inside
-- the run's metadata blob.
--
-- The executor persists each node's result the moment it completes, so an
-- inspector can read it while other branches are still running. With the
-- results inside the blob, every completion re-read, re-validated and
-- re-wrote every earlier result, response bodies included: a run of n nodes
-- cost O(n^2) work and bytes. A row per node makes each completion a single
-- upsert. Rows come back in insertion order (rowid); an upsert of a node that
-- already reported keeps its place.
CREATE TABLE run_node_results (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (run_id, node_id),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO run_node_results (run_id, node_id, result_json)
SELECT runs.id, json_extract(result.value, '$.nodeId'), result.value
FROM runs, json_each(runs.response_metadata_json, '$.results') AS result
WHERE json_type(runs.response_metadata_json, '$.results') = 'array'
  AND json_type(result.value, '$.nodeId') = 'text'
ORDER BY runs.id, result.key;

UPDATE runs SET response_metadata_json = json_remove(response_metadata_json, '$.results')
WHERE json_type(response_metadata_json, '$.results') IS NOT NULL;

-- Retention prunes each workflow's history down to its newest runs after every
-- run finishes; this serves that newest-first scan per workflow.
CREATE INDEX idx_runs_workflow_created ON runs(workflow_id, createdAt, id);
