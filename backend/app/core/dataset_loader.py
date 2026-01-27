"""
Dataset loading utilities for the social simulation backend.

This module is responsible for reading and validating the JSON files
defining persona categories, templates and interaction rules. It is
called at application startup to populate global data structures used
by the simulation engine. If the dataset is invalid or missing, an
exception is raised to prevent the server from starting with a
corrupted state.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List

from pydantic import ValidationError

from ..models.schemas import CategoryModel, PersonaTemplateModel, InteractionRuleModel


class Dataset:
    """Container for the loaded dataset.

    After loading, the dataset exposes lists and lookup dictionaries for
    categories, persona templates and interaction rules. These
    structures are used extensively by the simulation engine for
    efficient access during influence computations and agent creation.
    """

    def __init__(
        self,
        categories: List[CategoryModel],
        templates: List[PersonaTemplateModel],
        rules: List[InteractionRuleModel],
    ) -> None:
        self.categories: List[CategoryModel] = categories
        self.templates: List[PersonaTemplateModel] = templates
        self.rules: List[InteractionRuleModel] = rules
        # Build lookup dictionaries for convenience
        self.category_by_id: Dict[str, CategoryModel] = {c.category_id: c for c in categories}
        self.template_by_id: Dict[str, PersonaTemplateModel] = {t.template_id: t for t in templates}
        self.templates_by_category: Dict[str, List[PersonaTemplateModel]] = {}
        for t in templates:
            self.templates_by_category.setdefault(t.category_id, []).append(t)
        self.rules_by_pair: Dict[tuple[str, str], InteractionRuleModel] = {}
        for r in rules:
            self.rules_by_pair[(r.from_category, r.to_category)] = r


def _load_json_file(path: str) -> List[Dict]:
    """Helper to load a JSON file and return its content.

    Args:
        path: Absolute path to the JSON file.

    Returns:
        Parsed JSON content.

    Raises:
        FileNotFoundError: If the file does not exist.
        json.JSONDecodeError: If the file is not valid JSON.
    """
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_dataset(data_dir: str) -> Dataset:
    """Load and validate the dataset from disk.

    Args:
        data_dir: Path to the directory containing dataset JSON files.

    Returns:
        An instance of `Dataset` containing validated models.

    Raises:
        RuntimeError: If any dataset file is missing or invalid.
    """
    categories_path = os.path.join(data_dir, "categories.json")
    templates_path = os.path.join(data_dir, "persona_templates.json")
    rules_path = os.path.join(data_dir, "interaction_rules.json")

    # Ensure all files exist
    missing_files = [p for p in [categories_path, templates_path, rules_path] if not os.path.isfile(p)]
    if missing_files:
        raise RuntimeError(
            f"Dataset loading failed: missing files {', '.join(os.path.basename(p) for p in missing_files)}"
        )

    try:
        raw_categories = _load_json_file(categories_path)
        raw_templates = _load_json_file(templates_path)
        raw_rules = _load_json_file(rules_path)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Dataset loading failed: invalid JSON ({exc})")

    try:
        categories = [CategoryModel(**item) for item in raw_categories]
        templates = [PersonaTemplateModel(**item) for item in raw_templates]
        rules = [InteractionRuleModel(**item) for item in raw_rules]
    except ValidationError as exc:
        raise RuntimeError(f"Dataset validation failed: {exc}")

    # Additional consistency checks
    category_ids = {c.category_id for c in categories}
    for tpl in templates:
        if tpl.category_id not in category_ids:
            raise RuntimeError(
                f"Template '{tpl.template_id}' references unknown category '{tpl.category_id}'"
            )
    for rule in rules:
        if rule.from_category not in category_ids:
            raise RuntimeError(
                f"Interaction rule from unknown category '{rule.from_category}'"
            )
        if rule.to_category not in category_ids:
            raise RuntimeError(
                f"Interaction rule to unknown category '{rule.to_category}'"
            )

    return Dataset(categories=categories, templates=templates, rules=rules)