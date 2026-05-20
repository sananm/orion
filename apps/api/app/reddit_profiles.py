from __future__ import annotations

from collections import defaultdict

from .text_profiles import contains_phrase, normalize_text


REDDIT_TONE_ORDER = [
    "psychological",
    "disorienting",
    "suspenseful",
    "mysterious",
    "eerie",
    "claustrophobic",
    "dreamlike",
    "cerebral",
    "slow-burn",
    "intimate",
    "melancholic",
    "emotional",
    "devastating",
    "tragic",
    "bleak",
    "hopeful",
    "warm",
    "romantic",
    "comedic",
    "visceral",
]

REDDIT_TONE_RULES: dict[str, tuple[str, ...]] = {
    "psychological": (
        "psychological",
        "mind game",
        "mind games",
        "heady",
        "in your head",
        "mental breakdown",
        "unreliable narrator",
    ),
    "disorienting": (
        "disorienting",
        "confusing on purpose",
        "dementia simulator",
        "unreliable reality",
        "unsettling perspective",
        "losing your mind",
    ),
    "suspenseful": (
        "tense",
        "suspenseful",
        "edge of my seat",
        "nerve wracking",
        "anxiety inducing",
        "thrilling",
    ),
    "mysterious": (
        "mysterious",
        "enigmatic",
        "puzzling",
        "mystery",
        "keeps you guessing",
    ),
    "eerie": (
        "eerie",
        "haunting",
        "creepy",
        "unsettling",
        "disturbing",
    ),
    "claustrophobic": (
        "claustrophobic",
        "stifling",
        "suffocating",
        "trapped",
        "boxed in",
    ),
    "dreamlike": (
        "dreamlike",
        "surreal",
        "nightmarish",
        "trippy",
        "fever dream",
    ),
    "cerebral": (
        "cerebral",
        "thought provoking",
        "thought-provoking",
        "intellectual",
        "brainy",
        "philosophical",
    ),
    "slow-burn": (
        "slow burn",
        "slow-burn",
        "patient pacing",
        "deliberate pacing",
        "quietly builds",
    ),
    "intimate": (
        "intimate",
        "chamber piece",
        "small scale",
        "domestic",
        "character study",
    ),
    "melancholic": (
        "melancholic",
        "sad",
        "somber",
        "aching",
        "bittersweet",
    ),
    "emotional": (
        "emotional",
        "moving",
        "powerful",
        "heart wrenching",
        "heart-wrenching",
        "tearjerker",
    ),
    "devastating": (
        "devastating",
        "heartbreaking",
        "crushing",
        "wrecked me",
        "destroyed me",
        "gut punch",
        "gut-punch",
    ),
    "tragic": (
        "tragic",
        "tragedy",
        "doomed",
        "painful",
        "grief stricken",
        "grief-stricken",
    ),
    "bleak": (
        "bleak",
        "grim",
        "dark",
        "depressing",
        "hopeless",
        "nihilistic",
    ),
    "hopeful": (
        "hopeful",
        "uplifting",
        "redemptive",
        "life affirming",
        "life-affirming",
        "optimistic",
    ),
    "warm": (
        "warm",
        "gentle",
        "tender",
        "comforting",
        "heartwarming",
    ),
    "romantic": (
        "romantic",
        "romance",
        "love story",
        "chemistry",
        "swooning",
    ),
    "comedic": (
        "funny",
        "comedic",
        "laugh out loud",
        "laugh-out-loud",
        "hilarious",
        "witty",
    ),
    "visceral": (
        "visceral",
        "intense",
        "brutal",
        "pulse pounding",
        "pulse-pounding",
        "adrenaline",
    ),
}

REDDIT_CUE_RULES: dict[str, tuple[str, ...]] = {
    "grief": ("grief", "mourning", "bereavement"),
    "memory collapse": ("memory loss", "fading memories", "dementia", "alzheimer"),
    "unreliable reality": ("unreliable narrator", "unreliable reality", "loss of reality", "losing your mind"),
    "family fracture": ("family trauma", "family conflict", "father daughter", "mother son", "caregiver"),
    "identity fracture": ("identity crisis", "identity fracture", "mistaken identity"),
    "slow-burn": ("slow burn", "slow-burn", "patient pacing"),
    "performance-driven": ("performance", "acting", "anthony hopkins", "lead performance"),
    "romance": ("romance", "love story", "chemistry"),
    "twisty": ("twist", "twisty", "mind bending", "mind-bending"),
    "healing": ("healing", "redemption", "cathartic"),
}

REDDIT_DARK_TAGS = {
    "psychological",
    "disorienting",
    "suspenseful",
    "mysterious",
    "eerie",
    "claustrophobic",
    "melancholic",
    "devastating",
    "tragic",
    "bleak",
}

REDDIT_LIGHT_TAGS = {
    "hopeful",
    "warm",
    "romantic",
    "comedic",
}


def build_reddit_query(movie: dict) -> str:
    title = (movie.get("title") or "").strip()
    year = movie.get("year")
    if year:
        return f"\"{title}\" {year} movie"
    return f"\"{title}\" movie"


def build_reddit_backup_query(movie: dict) -> str:
    title = (movie.get("title") or "").strip()
    director = (movie.get("director") or "").strip()
    if director:
        return f"\"{title}\" {director} film"
    return f"\"{title}\" film"


def extract_reddit_profile(movie: dict, texts: list[str]) -> dict | None:
    joined = normalize_text(" ".join(texts))
    if not joined.strip():
        return None

    tone_scores: dict[str, int] = defaultdict(int)
    cue_scores: dict[str, int] = defaultdict(int)

    for tag, phrases in REDDIT_TONE_RULES.items():
        for phrase in phrases:
            if contains_phrase(joined, phrase):
                tone_scores[tag] += 2 if " " in phrase or "-" in phrase else 1

    for cue, phrases in REDDIT_CUE_RULES.items():
        for phrase in phrases:
            if contains_phrase(joined, phrase):
                cue_scores[cue] += 1

    tones = [
        tag
        for tag, score in sorted(
            tone_scores.items(),
            key=lambda item: (-item[1], REDDIT_TONE_ORDER.index(item[0]) if item[0] in REDDIT_TONE_ORDER else 999),
        )
        if score > 0
    ][:8]
    cues = [
        cue
        for cue, score in sorted(cue_scores.items(), key=lambda item: (-item[1], item[0]))
        if score > 0
    ][:6]

    if not tones and not cues:
        return None

    summary_parts: list[str] = []
    if tones:
        summary_parts.append("community tone: " + ", ".join(tones))
    if cues:
        summary_parts.append("discussion cues: " + ", ".join(cues))
    if movie.get("title"):
        summary_parts.append(f"source movie: {movie['title']}")

    return {
        "reddit_tone_tags": tones,
        "reddit_cues": cues,
        "reddit_summary": " ; ".join(summary_parts),
    }
