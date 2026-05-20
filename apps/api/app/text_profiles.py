from __future__ import annotations

from collections import defaultdict
import re


TONE_ORDER = [
    "psychological",
    "disorienting",
    "suspenseful",
    "mysterious",
    "eerie",
    "claustrophobic",
    "dreamlike",
    "cerebral",
    "contemplative",
    "intimate",
    "melancholic",
    "emotional",
    "tragic",
    "bleak",
    "hopeful",
    "warm",
    "romantic",
    "comedic",
    "visceral",
]

TONE_RULES: dict[str, tuple[str, ...]] = {
    "psychological": (
        "psychological",
        "obsession",
        "obsessive",
        "memory",
        "memory loss",
        "dementia",
        "alzheimer",
        "delusion",
        "hallucination",
        "identity",
        "mistaken identity",
        "perception",
        "reality",
        "subconscious",
        "anxious",
        "anxiety",
        "paranoia",
        "mental",
        "mind",
    ),
    "disorienting": (
        "disorienting",
        "confusion",
        "confused",
        "unreliable reality",
        "loss of sense of reality",
        "losing grip on reality",
        "dementia simulator",
    ),
    "suspenseful": (
        "thriller",
        "suspense",
        "stalker",
        "kidnapping",
        "disappearance",
        "investigation",
        "detective",
        "serial killer",
        "cat and mouse",
        "crime",
        "murder",
        "hostage",
        "survival",
    ),
    "mysterious": (
        "mystery",
        "enigmatic",
        "secret",
        "hidden truth",
        "conspiracy",
        "uncover",
        "puzzle",
        "missing person",
    ),
    "eerie": (
        "haunting",
        "haunted",
        "ghost",
        "uncanny",
        "creepy",
        "dread",
        "disturbing",
        "unsettling",
        "ominous",
    ),
    "claustrophobic": (
        "claustrophobic",
        "trapped",
        "confined",
        "isolated",
        "flat",
        "apartment",
        "room",
        "house arrest",
        "single location",
    ),
    "dreamlike": (
        "dream",
        "dream world",
        "surreal",
        "fantasy",
        "hallucination",
        "vision",
        "nightmare",
    ),
    "cerebral": (
        "cerebral",
        "intellectual",
        "philosophy",
        "high concept",
        "nonlinear",
        "time loop",
        "simulation",
        "parallel",
        "mind-bending",
    ),
    "contemplative": (
        "meditative",
        "reflective",
        "quiet",
        "slow burn",
        "character study",
        "introspective",
        "solitude",
    ),
    "intimate": (
        "family",
        "father daughter relationship",
        "mother son relationship",
        "marriage",
        "caregiving",
        "caregiver patient relationship",
        "relationship",
        "domestic",
    ),
    "melancholic": (
        "melancholic",
        "loneliness",
        "loss",
        "old age",
        "fading memories",
        "grief",
        "sorrow",
        "aging",
    ),
    "emotional": (
        "emotional",
        "heartbreaking",
        "family",
        "grief",
        "loss of loved one",
        "grieving mother",
        "grieving father",
        "death of son",
        "death of daughter",
        "caregiving",
        "trauma",
        "healing",
    ),
    "tragic": (
        "tragedy",
        "terminal illness",
        "death",
        "loss of loved one",
        "death of son",
        "death of daughter",
        "doomed",
        "fatal",
        "mourning",
    ),
    "bleak": (
        "bleak",
        "despair",
        "hopeless",
        "nihilistic",
        "brutal",
        "grim",
        "dark",
    ),
    "hopeful": (
        "hopeful",
        "resilience",
        "healing",
        "optimistic",
        "redemption",
        "uplifting",
        "friendship",
        "bravery",
        "save everything",
        "save the world",
        "save earth",
        "save humanity",
        "discovery",
    ),
    "warm": (
        "warm",
        "heartwarming",
        "feel-good",
        "gentle",
        "tender",
        "friendship",
        "companion",
    ),
    "romantic": (
        "romance",
        "romantic",
        "affair",
        "passion",
    ),
    "comedic": (
        "comedy",
        "funny",
        "humor",
        "humorous",
        "satire",
        "absurd",
        "witty",
    ),
    "visceral": (
        "action",
        "revenge",
        "violence",
        "war",
        "assassin",
        "heist",
        "combat",
        "pursuit",
        "escape",
    ),
}

DARK_TONE_TAGS = {
    "psychological",
    "disorienting",
    "suspenseful",
    "mysterious",
    "eerie",
    "claustrophobic",
    "melancholic",
    "tragic",
    "bleak",
}

LIGHT_TONE_TAGS = {
    "comedic",
    "warm",
    "hopeful",
    "romantic",
}

BROAD_GENRES = {
    "drama",
    "comedy",
}

STORY_CUE_ORDER = [
    "memory collapse",
    "unreliable reality",
    "identity fracture",
    "nonlinear structure",
    "grief spiral",
    "caregiver pressure",
    "investigation spiral",
]

STORY_CUE_RULES: dict[str, tuple[str, ...]] = {
    "memory collapse": (
        "memory loss",
        "amnesia",
        "dementia",
        "alzheimer",
        "fading memories",
        "lost memories",
    ),
    "unreliable reality": (
        "loss of sense of reality",
        "hallucination",
        "delusion",
        "unreliable reality",
        "confusion",
        "paranoia",
    ),
    "identity fracture": (
        "new identity",
        "double life",
        "mistaken identity",
        "split personality",
        "identity crisis",
        "impersonation",
    ),
    "nonlinear structure": (
        "nonlinear",
        "flashback",
        "time loop",
        "out of order",
        "fragmented memory",
        "fractured timeline",
    ),
    "grief spiral": (
        "grief",
        "mourning",
        "loss of loved one",
        "death of son",
        "death of daughter",
        "grieving mother",
        "grieving father",
    ),
    "caregiver pressure": (
        "caregiving",
        "caregiver patient relationship",
        "old age",
        "elderly",
        "father daughter relationship",
        "mother son relationship",
    ),
    "investigation spiral": (
        "investigation",
        "detective",
        "mystery",
        "missing person",
        "puzzle",
        "conspiracy",
    ),
}

STRUCTURAL_STORY_CUES = {
    "memory collapse",
    "unreliable reality",
    "identity fracture",
    "nonlinear structure",
}


def _normalized_list(values: list[str] | None) -> list[str]:
    return [value.strip() for value in values or [] if value and value.strip()]


def _normalized_set(values: list[str] | None) -> set[str]:
    return {value.lower() for value in _normalized_list(values)}


def normalize_text(text: str | None) -> str:
    lowered = (text or "").lower().replace("’", "'")
    return re.sub(r"\s+", " ", lowered)


def contains_phrase(text: str, phrase: str) -> bool:
    if not phrase:
        return False
    pattern = rf"(?<!\w){re.escape(phrase.lower())}(?!\w)"
    return re.search(pattern, text) is not None


def _joined_movie_text(movie: dict) -> str:
    return normalize_text(
        " ".join(
            [
                (movie.get("title") or ""),
                (movie.get("overview") or ""),
                " ".join(_normalized_list(movie.get("genres"))),
                " ".join(_normalized_list(movie.get("keywords"))),
            ]
        )
    )


def _text_contains_any(text: str, phrases: tuple[str, ...] | list[str]) -> bool:
    return any(contains_phrase(text, phrase) for phrase in phrases)


def extract_story_cues(movie: dict) -> list[str]:
    text = _joined_movie_text(movie)
    genres = _normalized_set(movie.get("genres"))
    scores: dict[str, int] = defaultdict(int)

    for cue, phrases in STORY_CUE_RULES.items():
        for phrase in phrases:
            if contains_phrase(text, phrase):
                scores[cue] += 2 if " " in phrase else 1

    if "thriller" in genres or "mystery" in genres:
        scores["investigation spiral"] += 1
    if "science fiction" in genres and _text_contains_any(
        text,
        ("memory", "reality", "identity", "simulation", "parallel"),
    ):
        scores["nonlinear structure"] += 1
        scores["unreliable reality"] += 1
    if "drama" in genres and _text_contains_any(
        text,
        ("caregiving", "old age", "elderly", "father daughter relationship", "mother son relationship"),
    ):
        scores["caregiver pressure"] += 1
    if "drama" in genres and _text_contains_any(
        text,
        ("grief", "loss of loved one", "death of son", "death of daughter"),
    ):
        scores["grief spiral"] += 1

    ordered = sorted(
        scores.items(),
        key=lambda item: (-item[1], STORY_CUE_ORDER.index(item[0]) if item[0] in STORY_CUE_ORDER else 999),
    )
    return [cue for cue, score in ordered if score > 0][:5]


def extract_tone_tags(movie: dict) -> list[str]:
    text = _joined_movie_text(movie)
    genres = _normalized_set(movie.get("genres"))
    scores: dict[str, int] = defaultdict(int)

    for tag, phrases in TONE_RULES.items():
        for phrase in phrases:
            if contains_phrase(text, phrase):
                scores[tag] += 2 if " " in phrase else 1

    if "thriller" in genres or "mystery" in genres:
        scores["suspenseful"] += 2
        scores["mysterious"] += 1
    if "horror" in genres:
        scores["eerie"] += 2
        scores["bleak"] += 1
    if "adventure" in genres:
        scores["hopeful"] += 1
        scores["visceral"] += 1
    if "science fiction" in genres and _text_contains_any(
        text,
        ("dream", "reality", "memory", "subconscious", "simulation"),
    ):
        scores["cerebral"] += 1
        scores["dreamlike"] += 1
    if "romance" in genres:
        scores["romantic"] += 1
    if "action" in genres or "war" in genres:
        scores["visceral"] += 1
    if "drama" in genres and _text_contains_any(
        text,
        ("family", "caregiving", "relationship", "grief", "loss", "old age"),
    ):
        scores["intimate"] += 1
        scores["emotional"] += 1
    if "comedy" in genres:
        scores["comedic"] += 2
    if not scores and "drama" in genres:
        scores["emotional"] += 1

    ordered = sorted(
        scores.items(),
        key=lambda item: (-item[1], TONE_ORDER.index(item[0]) if item[0] in TONE_ORDER else len(TONE_ORDER)),
    )
    return [tag for tag, score in ordered if score > 0][:6]


def build_embedding_text(movie: dict) -> str:
    story_cues = extract_story_cues(movie)
    parts: list[str] = []
    if movie.get("title"):
        parts.append("title: " + movie["title"])
    if movie.get("year"):
        parts.append(f"year: {movie['year']}")
    if movie.get("overview"):
        parts.append("plot: " + movie["overview"])
    if story_cues:
        parts.append("story structure: " + ", ".join(story_cues))
    if movie.get("genres"):
        parts.append("genres: " + ", ".join(_normalized_list(movie["genres"])))
    if movie.get("keywords"):
        parts.append("plot keywords: " + ", ".join(_normalized_list(movie["keywords"])[:15]))
    return " ; ".join(parts)


def build_tone_text(
    movie: dict,
    tone_tags: list[str] | None = None,
    story_cues: list[str] | None = None,
) -> str:
    tone_tags = tone_tags or extract_tone_tags(movie)
    story_cues = story_cues or extract_story_cues(movie)
    keywords = _normalized_list(movie.get("keywords"))
    tonal_keywords = [
        keyword
        for keyword in keywords
        if any(
            marker in keyword.lower()
            for marker in (
                "memory",
                "dementia",
                "alzheimer",
                "identity",
                "mistaken identity",
                "reality",
                "dream",
                "grief",
                "loss",
                "care",
                "caregiver",
                "relationship",
                "obsession",
                "anxious",
                "violence",
                "revenge",
                "mystery",
                "paranoia",
                "loneliness",
                "aging",
                "old age",
                "elderly",
                "fading memories",
                "survival",
                "friendship",
                "bravery",
                "save earth",
                "save the world",
                "save humanity",
            )
        )
    ]

    parts: list[str] = []
    if movie.get("title"):
        parts.append("title: " + movie["title"])
    if tone_tags:
        parts.append("tone: " + ", ".join(tone_tags))
    if story_cues:
        parts.append("story cues: " + ", ".join(story_cues))
    if tonal_keywords:
        parts.append("mood cues: " + ", ".join(tonal_keywords[:8]))
    if movie.get("overview"):
        parts.append("overview: " + movie["overview"])
    if movie.get("genres"):
        parts.append("genres: " + ", ".join(_normalized_list(movie["genres"])))
    return " ; ".join(parts)


def build_text_profile(movie: dict) -> dict:
    tone_tags = extract_tone_tags(movie)
    story_cues = extract_story_cues(movie)
    return {
        "embedding_text": build_embedding_text(movie),
        "tone_tags": tone_tags,
        "story_cues": story_cues,
        "tone_text": build_tone_text(movie, tone_tags, story_cues),
    }
