from app.utils.workflow_integrity import (
    count_nodes_edges,
    is_default_start_only_graph,
    summarize_workflows,
)


def test_is_default_start_only_graph_true_for_canonical_start_node():
    workflow = {
        "workflowId": "wf-1",
        "name": "Example",
        "nodes": [
            {
                "nodeId": "start-1",
                "type": "start",
                "label": "Start",
                "position": {"x": 250, "y": 50},
                "config": {},
            }
        ],
        "edges": [],
        "variables": {"catID": "response.body.id"},
    }

    assert is_default_start_only_graph(workflow) is True


def test_is_default_start_only_graph_false_for_nontrivial_workflow():
    workflow = {
        "workflowId": "wf-2",
        "name": "Complex",
        "nodes": [
            {"nodeId": "start-1", "type": "start"},
            {"nodeId": "http-1", "type": "http-request"},
        ],
        "edges": [{"edgeId": "e-1", "source": "start-1", "target": "http-1"}],
    }

    assert is_default_start_only_graph(workflow) is False


def test_count_nodes_edges_and_summary_shape():
    workflow = {
        "workflowId": "wf-3",
        "name": "Workflow 3",
        "nodes": [{"nodeId": "start-1", "type": "start"}],
        "edges": [],
    }

    node_count, edge_count = count_nodes_edges(workflow)
    assert node_count == 1
    assert edge_count == 0

    summary = summarize_workflows([workflow])
    assert len(summary) == 1
    assert summary[0].workflow_id == "wf-3"
    assert summary[0].default_start_only is True
