"""Tests for remx.core.topology module."""
import sqlite3

import pytest

from remx.core.db import get_db
from remx.core.topology import (
    REL_TYPES,
    REL_ROLES,
    DEFAULT_CONTEXT,
    ensure_node,
    list_nodes,
    insert_relation,
    delete_relation,
    query_relations,
    get_related_nodes,
    match_context,
    topology_aware_recall,
)


class TestConstants:
    def test_rel_types_has_six_types(self):
        assert len(REL_TYPES) == 6
        assert "因果关系" in REL_TYPES
        assert "相关性" in REL_TYPES

    def test_rel_roles_defined(self):
        assert "cause" in REL_ROLES
        assert "effect" in REL_ROLES
        assert "component" in REL_ROLES
        assert "whole" in REL_ROLES
        assert "related" in REL_ROLES
        assert "opponent" in REL_ROLES

    def test_default_context_is_global(self):
        assert DEFAULT_CONTEXT == "global"


class TestEnsureNode:
    def test_ensure_node_inserts_new_node(self, db_with_schema):
        ensure_node(db_with_schema, "n1", "demand", "Test chunk content")
        nodes = list_nodes(db_with_schema)
        assert any(n["id"] == "n1" for n in nodes)

    def test_ensure_node_ignores_duplicate(self, db_with_schema):
        ensure_node(db_with_schema, "n2", "demand", "First")
        ensure_node(db_with_schema, "n2", "demand", "Second")
        nodes = list_nodes(db_with_schema, category="demand")
        assert sum(1 for n in nodes if n["id"] == "n2") == 1


class TestListNodes:
    def test_list_nodes_empty(self, db_with_schema):
        assert list_nodes(db_with_schema) == []

    def test_list_nodes_filter_by_category(self, db_with_schema):
        ensure_node(db_with_schema, "nc1", "demand", "chunk a")
        ensure_node(db_with_schema, "nc2", "issue", "chunk b")
        demand_nodes = list_nodes(db_with_schema, category="demand")
        assert all(n["category"] == "demand" for n in demand_nodes)


class TestInsertRelation:
    def test_insert_relation_requires_two_nodes(self, db_with_schema):
        ensure_node(db_with_schema, "r1", "demand", "node a")
        with pytest.raises(AssertionError, match="need at least 2 participants"):
            insert_relation(db_with_schema, "因果关系", ["r1"], ["cause"])

    def test_insert_relation_validates_rel_type(self, db_with_schema):
        ensure_node(db_with_schema, "x1", "demand", "a")
        ensure_node(db_with_schema, "x2", "demand", "b")
        with pytest.raises(AssertionError, match="invalid rel_type"):
            insert_relation(db_with_schema, "invalid_type", ["x1", "x2"], ["cause", "effect"])

    def test_insert_relation_validates_role(self, db_with_schema):
        ensure_node(db_with_schema, "y1", "demand", "a")
        ensure_node(db_with_schema, "y2", "demand", "b")
        with pytest.raises(AssertionError, match="invalid role"):
            insert_relation(db_with_schema, "因果关系", ["y1", "y2"], ["cause", "bad_role"])

    def test_insert_relation_returns_rel_id(self, db_with_schema):
        ensure_node(db_with_schema, "z1", "demand", "a")
        ensure_node(db_with_schema, "z2", "demand", "b")
        rel_id = insert_relation(
            db_with_schema,
            "因果关系",
            ["z1", "z2"],
            ["cause", "effect"],
            context="main_session",
            description="test relation",
        )
        assert rel_id > 0
        rels = query_relations(db_with_schema, "z1")
        assert len(rels) == 1
        assert rels[0]["rel_type"] == "因果关系"
        assert rels[0]["description"] == "test relation"

    def test_insert_relation_symmetric(self, db_with_schema):
        ensure_node(db_with_schema, "s1", "demand", "a")
        ensure_node(db_with_schema, "s2", "demand", "b")
        rel_id = insert_relation(
            db_with_schema,
            "相关性",
            ["s1", "s2"],
            ["related", "related"],
        )
        rels_s1 = query_relations(db_with_schema, "s1")
        rels_s2 = query_relations(db_with_schema, "s2")
        assert len(rels_s1) == 1
        assert len(rels_s2) == 1
        assert rels_s1[0]["relation_id"] == rel_id


class TestDeleteRelation:
    def test_delete_relation_removes_it(self, db_with_schema):
        ensure_node(db_with_schema, "d1", "demand", "a")
        ensure_node(db_with_schema, "d2", "demand", "b")
        rel_id = insert_relation(
            db_with_schema, "因果关系", ["d1", "d2"], ["cause", "effect"]
        )
        delete_relation(db_with_schema, rel_id)
        rels = query_relations(db_with_schema, "d1")
        assert all(r["relation_id"] != rel_id for r in rels)


class TestQueryRelations:
    def test_query_relations_context_filter_global(self, db_with_schema):
        ensure_node(db_with_schema, "c1", "demand", "a")
        ensure_node(db_with_schema, "c2", "demand", "b")
        insert_relation(
            db_with_schema,
            "因果关系",
            ["c1", "c2"],
            ["cause", "effect"],
            context=None,  # global
        )
        # Should match with any context
        assert len(query_relations(db_with_schema, "c1", current_context="group_chat")) == 1

    def test_query_relations_context_exact_match(self, db_with_schema):
        ensure_node(db_with_schema, "m1", "demand", "a")
        ensure_node(db_with_schema, "m2", "demand", "b")
        insert_relation(
            db_with_schema,
            "相关性",
            ["m1", "m2"],
            ["related", "related"],
            context="main_session",
        )
        # Should match
        assert len(query_relations(db_with_schema, "m1", current_context="main_session")) == 1
        # Should not match different context
        assert len(query_relations(db_with_schema, "m1", current_context="group_chat")) == 0


class TestGetRelatedNodes:
    def test_get_related_nodes_one_hop(self, db_with_schema):
        ensure_node(db_with_schema, "g1", "demand", "a")
        ensure_node(db_with_schema, "g2", "demand", "b")
        insert_relation(
            db_with_schema, "因果关系", ["g1", "g2"], ["cause", "effect"]
        )
        result = get_related_nodes(db_with_schema, "g1", max_depth=1)
        assert "g2" in result
        assert result["g2"]["depth"] == 1

    def test_get_related_nodes_max_depth_respected(self, db_with_schema):
        ensure_node(db_with_schema, "h1", "demand", "a")
        ensure_node(db_with_schema, "h2", "demand", "b")
        insert_relation(
            db_with_schema, "因果关系", ["h1", "h2"], ["cause", "effect"]
        )
        result = get_related_nodes(db_with_schema, "h1", max_depth=0)
        # max_depth=0 should return empty (no traversal)
        assert "h2" not in result


class TestMatchContext:
    def test_match_context_none_is_always_true(self):
        assert match_context(None, "anything") is True
        assert match_context(None, None) is True

    def test_match_context_global_is_always_true(self):
        assert match_context("global", "main_session") is True
        assert match_context("global", None) is True

    def test_match_context_exact_match(self):
        assert match_context("main_session", "main_session") is True
        assert match_context("group_chat", "main_session") is False


class TestTopologyAwareRecall:
    def test_topology_aware_recall_empty_base(self, db_with_schema):
        result = topology_aware_recall(db_with_schema, [])
        assert result == []

    def test_topology_aware_recall_no_relations(self, db_with_schema):
        ensure_node(db_with_schema, "t1", "demand", "chunk t1")
        base = [{"id": "t1", "category": "demand", "chunk": "chunk t1"}]
        result = topology_aware_recall(db_with_schema, base)
        assert result == []

    def test_topology_aware_recall_expands_via_relation(self, db_with_schema):
        ensure_node(db_with_schema, "p1", "demand", "parent chunk")
        ensure_node(db_with_schema, "p2", "demand", "child chunk")
        insert_relation(
            db_with_schema, "组成性", ["p1", "p2"], ["whole", "component"]
        )
        base = [{"id": "p1", "category": "demand", "chunk": "parent chunk"}]
        result = topology_aware_recall(db_with_schema, base, max_additional=5)
        assert len(result) == 1
        assert result[0]["id"] == "p2"
        assert result[0]["source"] == "topology"
