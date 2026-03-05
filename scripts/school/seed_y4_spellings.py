"""Seed Year 4 spellings from the school website DOCX into Supabase."""
import json
import os
import sys
from supabase import create_client

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://modjoikyuhqzouxvieua.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_KEY:
    # Try loading from .env.local
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", ".env.local")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                    SUPABASE_KEY = line.split("=", 1)[1].strip()

if not SUPABASE_KEY:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY not found")
    sys.exit(1)

# Y4 spellings parsed from Y4-spelling-overview-dated.docx
# 36 weeks, grouped by phoneme, 12 words per week (4 rows x 3 words)
Y4_SPELLINGS = [
    {"week": 1, "phoneme": "ay", "words": ["display", "plane", "plain", "rain", "rein", "reign", "eighth", "regulate", "brake", "break", "grate", "great"]},
    {"week": 2, "phoneme": "e", "words": ["mention", "peculiar", "possession", "pressure", "bread", "accept", "except", "whether", "weather", "any", "extreme", "many"]},
    {"week": 3, "phoneme": "ee", "words": ["peace", "piece", "bury", "berry", "empathy", "sympathy", "heal", "heel", "he'll", "peculiar", "various", "reveal"]},
    {"week": 4, "phoneme": "i", "words": ["experiment", "history", "imagine", "increase", "binoculars", "stability", "ordinary", "building", "analysis", "image", "builder", "fitter"]},
    {"week": 5, "phoneme": "ie", "words": ["tie", "site", "survive", "highlight", "style", "incisor", "excise", "homicide", "deny", "describe", "exercise", "height"]},
    {"week": 6, "phoneme": "oe", "words": ["telescope", "periscope", "microscope", "microchip", "sole", "role", "code", "potatoes", "notice", "although", "notice", "shown"]},
    {"week": 7, "phoneme": "u/schwa", "words": ["unfair", "undone", "enough", "reluctant", "company", "method", "random", "rough", "tough", "millimetre", "millilitre", "recover"]},
    {"week": 8, "phoneme": "ue", "words": ["popular", "regular", "few", "pursue", "unicycle", "unique", "united", "evacuate", "vacuum", "neutral", "stewed", "chewy"]},
    {"week": 9, "phoneme": "ar", "words": ["heart", "guard", "market", "target", "father", "farther", "past", "passed", "disaster", "barge", "calm", "farmer"]},
    {"week": 10, "phoneme": "ear", "words": ["weary", "cereal", "serial", "interfere", "sincerely", "experience", "period", "here", "hear", "peer", "pier", "steered"]},
    {"week": 11, "phoneme": "er", "words": ["firm", "consider", "exercise", "verdict", "learn", "grammar", "favourite", "peculiar", "popular", "certain", "certificate", "ascertain"]},
    {"week": 12, "phoneme": "oo", "words": ["fool", "grew", "group", "bruise", "suitable", "revolution", "lose", "remove", "choose", "cruise", "rudest", "undo"]},
    {"week": 13, "phoneme": "or", "words": ["corpse", "corporal", "corporation", "extraordinary", "export", "import", "audio", "audience", "audible", "organise", "overall", "source"]},
    {"week": 14, "phoneme": "f", "words": ["forward", "fruit", "affect", "effect", "phase", "efficient", "giraffe", "magnify", "magnificent", "often", "therefore", "fearsome"]},
    {"week": 15, "phoneme": "g", "words": ["grammar", "fatigue", "category", "ghost", "trigger", "investigate", "tiger", "guest", "guessed", "dialogue", "monologue", "gravest"]},
    {"week": 16, "phoneme": "j", "words": ["inject", "object", "imagine", "geography", "knowledge", "suggest", "image", "submerge", "adjust", "intelligence", "jolliest", "jogger"]},
    {"week": 17, "phoneme": "k", "words": ["accident", "oblique", "cheque", "scheme", "affect", "effect", "link", "acrobat", "acronym", "acropolis", "predict", "character"]},
    {"week": 18, "phoneme": "l", "words": ["knowledge", "library", "particular", "popular", "allowed", "aloud", "example", "typical", "mental", "label", "steel", "steal"]},
    {"week": 19, "phoneme": "m", "words": ["lamb", "cemetery", "determined", "embarrassed", "committee", "community", "communication", "common", "condemn", "familiar", "overcome", "thumb"]},
    {"week": 20, "phoneme": "n", "words": ["apparent", "controversy", "correspond", "recommend", "context", "contract", "environment", "knowledge", "reign", "innovate", "examine", "examining"]},
    {"week": 21, "phoneme": "p", "words": ["pedal", "pedestrian", "compel", "expel", "repel", "pentathlon", "popular", "support", "supply", "appearance", "unpopular", "portable"]},
    {"week": 22, "phoneme": "r", "words": ["grammar", "increase", "interest", "library", "natural", "probably", "promise", "recent", "wrong", "ferry", "error", "redder"]},
    {"week": 23, "phoneme": "s", "words": ["separate", "special", "suppose", "politics", "access", "nonetheless", "circle", "decide", "exercise", "medicine", "crescent", "sentence"]},
    {"week": 24, "phoneme": "t", "words": ["history", "important", "interest", "material", "affect", "effect", "opposite", "attract", "receipt", "notice", "straight", "strength"]},
    {"week": 25, "phoneme": "z", "words": ["zip", "fizz", "busy", "business", "exercise", "deposit", "impose", "positive", "possession", "lose", "dose", "surprise"]},
    {"week": 26, "phoneme": "sh", "words": ["establish", "machine", "extension", "pressure", "possession", "mention", "action", "tradition", "option", "nation", "electrician", "politician"]},
    {"week": 27, "phoneme": "ay", "words": ["layer", "misbehave", "mistake", "locate", "relocate", "dislocate", "wailing", "aid", "weight", "survey", "gazing", "ached"]},
    {"week": 28, "phoneme": "ee", "words": ["guarantee", "feature", "release", "kilogram", "brief", "library", "liberty", "novelty", "perceive", "deceive", "create", "cereal"]},
    {"week": 29, "phoneme": "ie", "words": ["insight", "verify", "surprise", "guide", "combine", "decline", "file", "library", "bible", "identical", "identify", "refine"]},
    {"week": 30, "phoneme": "er", "words": ["confirm", "herbal", "herbivore", "permanent", "persist", "persistent", "transfer", "research", "calendar", "referred", "father", "farther"]},
    {"week": 31, "phoneme": "k", "words": ["physical", "category", "abstract", "detect", "chronological", "chronic", "scheme", "impact", "location", "question", "technology", "communicate"]},
    {"week": 32, "phoneme": "l", "words": ["alter", "altar", "probably", "bible", "collapse", "collision", "conclusion", "parallel", "excellent", "develop", "cereal", "serial"]},
    {"week": 33, "phoneme": "s", "words": ["script", "consider", "intensity", "democracy", "novice", "sequence", "exceed", "discipline", "fascinate", "experience", "purpose", "police"]},
    {"week": 34, "phoneme": "sh", "words": ["publish", "tension", "tissue", "proclamation", "exclamation", "intention", "tradition", "non-fiction", "population", "transition", "special", "crucial"]},
    {"week": 35, "phoneme": "ee", "words": ["steel", "steal", "millipede", "theme", "deceive", "antibiotic", "antisocial", "anticlockwise", "familiar", "obvious", "regal", "theory"]},
    {"week": 36, "phoneme": "s", "words": ["absolute", "consistent", "necessary", "evidence", "concept", "society", "scent", "thistle", "influence", "nonsense", "cease", "circumstances"]},
]

def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Clear existing Y4 spellings for this year
    sb.table("school_spellings").delete().eq("child_name", "Emmie").eq("academic_year", "2025-26").execute()

    rows = []
    for week_data in Y4_SPELLINGS:
        rows.append({
            "child_name": "Emmie",
            "year_group": "Year 4",
            "academic_year": "2025-26",
            "week_number": week_data["week"],
            "phoneme": week_data["phoneme"],
            "words": json.dumps(week_data["words"]),
            "source": "website",
        })

    # Batch insert
    result = sb.table("school_spellings").upsert(rows, on_conflict="child_name,academic_year,week_number").execute()
    print(f"Seeded {len(result.data)} weeks of Y4 spellings for Emmie")

    # Verify
    count = sb.table("school_spellings").select("*", count="exact").eq("child_name", "Emmie").execute()
    print(f"Total rows in school_spellings for Emmie: {count.count}")

if __name__ == "__main__":
    main()
