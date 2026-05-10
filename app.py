import os
import base64
import json
from flask import Flask, render_template, jsonify
import anthropic

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_PATH = os.path.join(BASE_DIR, "static", "images", "battle-scene.png")

# Resolve API key from env or Claude Code session token
def _get_api_key():
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        token_file = os.path.expanduser("~/.claude/remote/.session_ingress_token")
        if os.path.exists(token_file):
            with open(token_file) as f:
                key = f.read().strip()
    return key or None

FALLBACK_DATA = {
    "player_team": {
        "name": "Fewline Force",
        "description": "Elite feline warriors",
        "characters": [
            {
                "id": "ironpaw", "name": "Ironpaw", "animal": "Tabby Cat", "class": "Warrior",
                "emoji": "🐱", "color": "#8B7355",
                "hp": 120, "max_hp": 120, "mp": 40, "max_mp": 40, "atk": 18, "def": 15, "spd": 10,
                "skills": [
                    {"key": "Q", "name": "Hammer Strike", "damage": 30, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A powerful hammer blow"},
                    {"key": "W", "name": "Whirlwind", "damage": 18, "mp_cost": 15, "type": "physical", "hits": 3, "description": "Spin attack hitting all enemies"},
                    {"key": "E", "name": "Iron Guard", "damage": 0, "mp_cost": 10, "type": "support", "hits": 0, "description": "Raise defense for 3 turns"},
                    {"key": "R", "name": "Crushing Blow", "damage": 55, "mp_cost": 25, "type": "physical", "hits": 1, "description": "A devastating heavy attack"}
                ]
            },
            {
                "id": "luna", "name": "Luna", "animal": "White Cat", "class": "Mage",
                "emoji": "✨", "color": "#6699CC",
                "hp": 70, "max_hp": 70, "mp": 90, "max_mp": 90, "atk": 22, "def": 6, "spd": 14,
                "skills": [
                    {"key": "Q", "name": "Frost Bolt", "damage": 28, "mp_cost": 10, "type": "magic", "hits": 1, "description": "A bolt of ice magic"},
                    {"key": "W", "name": "Blizzard", "damage": 20, "mp_cost": 30, "type": "magic", "hits": 3, "description": "Ice storm hitting all enemies"},
                    {"key": "E", "name": "Mana Shield", "damage": 0, "mp_cost": 20, "type": "support", "hits": 0, "description": "Creates a magic barrier"},
                    {"key": "R", "name": "Arcane Nova", "damage": 65, "mp_cost": 40, "type": "magic", "hits": 1, "description": "Massive burst of arcane energy"}
                ]
            },
            {
                "id": "shadow", "name": "Shadow", "animal": "Black Cat", "class": "Archer",
                "emoji": "🏹", "color": "#445566",
                "hp": 80, "max_hp": 80, "mp": 60, "max_mp": 60, "atk": 20, "def": 8, "spd": 20,
                "skills": [
                    {"key": "Q", "name": "Shadow Arrow", "damage": 25, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A swift arrow from the shadows"},
                    {"key": "W", "name": "Rain of Arrows", "damage": 15, "mp_cost": 20, "type": "physical", "hits": 4, "description": "Fires multiple arrows at all foes"},
                    {"key": "E", "name": "Smoke Screen", "damage": 0, "mp_cost": 15, "type": "support", "hits": 0, "description": "Boosts evasion for 3 turns"},
                    {"key": "R", "name": "Sniper Shot", "damage": 70, "mp_cost": 30, "type": "physical", "hits": 1, "description": "A precise deadly shot"}
                ]
            },
            {
                "id": "wildfire", "name": "Wildfire", "animal": "Wildcat", "class": "Berserker",
                "emoji": "🔥", "color": "#CC4400",
                "hp": 100, "max_hp": 100, "mp": 30, "max_mp": 30, "atk": 25, "def": 10, "spd": 15,
                "skills": [
                    {"key": "Q", "name": "Wild Claw", "damage": 35, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A fierce claw attack"},
                    {"key": "W", "name": "Frenzy", "damage": 18, "mp_cost": 15, "type": "physical", "hits": 3, "description": "A frenzied combo attack"},
                    {"key": "E", "name": "Berserk", "damage": 0, "mp_cost": 0, "type": "support", "hits": 0, "description": "Greatly boost ATK for 3 turns"},
                    {"key": "R", "name": "Raging Storm", "damage": 55, "mp_cost": 25, "type": "physical", "hits": 2, "description": "Explosive feral power unleashed"}
                ]
            },
            {
                "id": "whisker", "name": "Whisker", "animal": "Gray Cat", "class": "Healer",
                "emoji": "💚", "color": "#336633",
                "hp": 75, "max_hp": 75, "mp": 80, "max_mp": 80, "atk": 12, "def": 12, "spd": 16,
                "skills": [
                    {"key": "Q", "name": "Quick Strike", "damage": 20, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A swift light attack"},
                    {"key": "W", "name": "Heal", "damage": -35, "mp_cost": 20, "type": "heal", "hits": 1, "description": "Restore HP to the weakest ally"},
                    {"key": "E", "name": "Rally", "damage": 0, "mp_cost": 25, "type": "support", "hits": 0, "description": "Boost team ATK for 3 turns"},
                    {"key": "R", "name": "Full Restore", "damage": -70, "mp_cost": 40, "type": "heal", "hits": 1, "description": "Massively restore an ally's HP"}
                ]
            }
        ]
    },
    "enemy_team": {
        "name": "Canine Coalition",
        "description": "A fierce pack of canine warriors",
        "characters": [
            {
                "id": "rex", "name": "Rex", "animal": "German Shepherd", "class": "Swordsman",
                "emoji": "🗡️", "color": "#8B6914",
                "hp": 110, "max_hp": 110, "mp": 50, "max_mp": 50, "atk": 19, "def": 14, "spd": 12,
                "skills": [
                    {"key": "Q", "name": "Sword Slash", "damage": 28, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A precise sword attack"},
                    {"key": "W", "name": "Cross Cut", "damage": 22, "mp_cost": 15, "type": "physical", "hits": 2, "description": "Two powerful slashes"},
                    {"key": "E", "name": "Guard", "damage": 0, "mp_cost": 10, "type": "support", "hits": 0, "description": "Raises defense"},
                    {"key": "R", "name": "Final Judgment", "damage": 60, "mp_cost": 30, "type": "physical", "hits": 1, "description": "A devastating final strike"}
                ]
            },
            {
                "id": "ember", "name": "Ember", "animal": "Shiba Inu", "class": "Warrior",
                "emoji": "🔥", "color": "#CC6600",
                "hp": 95, "max_hp": 95, "mp": 45, "max_mp": 45, "atk": 17, "def": 12, "spd": 16,
                "skills": [
                    {"key": "Q", "name": "Fire Bite", "damage": 26, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A burning bite attack"},
                    {"key": "W", "name": "Flame Dash", "damage": 35, "mp_cost": 20, "type": "physical", "hits": 1, "description": "Rush through enemies with fire"},
                    {"key": "E", "name": "Ember Howl", "damage": 15, "mp_cost": 10, "type": "magic", "hits": 3, "description": "Fiery howl hitting multiple targets"},
                    {"key": "R", "name": "Inferno Rage", "damage": 55, "mp_cost": 35, "type": "physical", "hits": 1, "description": "Explosive fire attack"}
                ]
            },
            {
                "id": "flash", "name": "Flash", "animal": "Greyhound", "class": "Scout",
                "emoji": "⚡", "color": "#888888",
                "hp": 75, "max_hp": 75, "mp": 55, "max_mp": 55, "atk": 16, "def": 7, "spd": 24,
                "skills": [
                    {"key": "Q", "name": "Quick Bite", "damage": 20, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A lightning-fast bite"},
                    {"key": "W", "name": "Blitz", "damage": 15, "mp_cost": 15, "type": "physical", "hits": 3, "description": "Triple speed attacks on all foes"},
                    {"key": "E", "name": "Evasion", "damage": 0, "mp_cost": 10, "type": "support", "hits": 0, "description": "Drastically boost evasion"},
                    {"key": "R", "name": "Sonic Rush", "damage": 50, "mp_cost": 25, "type": "physical", "hits": 2, "description": "Devastating speed attack"}
                ]
            },
            {
                "id": "bruno", "name": "Bruno", "animal": "St. Bernard", "class": "Support",
                "emoji": "🛡️", "color": "#8B4513",
                "hp": 105, "max_hp": 105, "mp": 70, "max_mp": 70, "atk": 13, "def": 17, "spd": 8,
                "skills": [
                    {"key": "Q", "name": "Heavy Paw", "damage": 22, "mp_cost": 0, "type": "physical", "hits": 1, "description": "A powerful paw strike"},
                    {"key": "W", "name": "Rescue", "damage": -30, "mp_cost": 20, "type": "heal", "hits": 1, "description": "Heal an ally"},
                    {"key": "E", "name": "Fortress", "damage": 0, "mp_cost": 25, "type": "support", "hits": 0, "description": "Boost team defense"},
                    {"key": "R", "name": "Pack Leader", "damage": -55, "mp_cost": 35, "type": "heal", "hits": 1, "description": "Major heal for lowest HP ally"}
                ]
            }
        ]
    }
}


def extract_json(text):
    text = text.strip()
    if "```" in text:
        for part in text.split("```"):
            stripped = part.strip()
            if stripped.startswith("json"):
                stripped = stripped[4:].strip()
            if stripped.startswith("{"):
                text = stripped
                break
    start = text.find("{")
    end = text.rfind("}") + 1
    if start != -1 and end > start:
        return text[start:end]
    return text


def validate_team(team_data):
    for char in team_data.get("characters", []):
        char.setdefault("emoji", "⚔️")
        char.setdefault("color", "#888888")
        char.setdefault("max_hp", char.get("hp", 100))
        char.setdefault("max_mp", char.get("mp", 50))
        char.setdefault("hp", char["max_hp"])
        char.setdefault("mp", char["max_mp"])
        char.setdefault("atk", 15)
        char.setdefault("def", 10)
        char.setdefault("spd", 12)
        for skill in char.get("skills", []):
            skill.setdefault("mp_cost", 0)
            skill.setdefault("hits", 1)
            skill.setdefault("type", "physical")
            skill.setdefault("description", skill.get("name", "Attack"))


def get_characters_from_image():
    client = anthropic.Anthropic(api_key=_get_api_key())

    with open(IMAGE_PATH, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    prompt = """Analyze this fantasy battle game screenshot carefully.

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "player_team": {
    "name": "team name visible at top-left",
    "description": "short team description",
    "characters": [
      {
        "id": "snake_case_id",
        "name": "character name",
        "animal": "animal type",
        "class": "Warrior/Mage/Archer/Support/Berserker/Scout/etc",
        "emoji": "single emoji",
        "color": "#hexcolor",
        "hp": 80,
        "max_hp": 80,
        "mp": 50,
        "max_mp": 50,
        "atk": 15,
        "def": 10,
        "spd": 12,
        "skills": [
          {"key": "Q", "name": "skill name", "damage": 25, "mp_cost": 0, "type": "physical", "hits": 1, "description": "short desc"},
          {"key": "W", "name": "skill name", "damage": 20, "mp_cost": 15, "type": "physical", "hits": 3, "description": "short desc"},
          {"key": "E", "name": "skill name", "damage": 0, "mp_cost": 10, "type": "support", "hits": 0, "description": "short desc"},
          {"key": "R", "name": "skill name", "damage": 60, "mp_cost": 30, "type": "physical", "hits": 1, "description": "short desc"}
        ]
      }
    ]
  },
  "enemy_team": {
    "name": "team name visible at top-right",
    "description": "short team description",
    "characters": [same structure]
  }
}

Rules:
- Left team (cats) = player_team, right team (dogs) = enemy_team
- Create 4-5 characters per team based on portraits and battle scene
- hits >= 3 means the skill hits ALL enemies (AoE)
- type "heal" has negative damage value (e.g. -35 means heal 35 HP)
- type "support" means buff (0 damage, 0 hits)
- Balance: hp 70-130, mp 30-90, atk 12-25, def 5-18, spd 8-24"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4000,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": image_data}
                },
                {"type": "text", "text": prompt}
            ]
        }]
    )

    json_str = extract_json(message.content[0].text)
    data = json.loads(json_str)

    validate_team(data["player_team"])
    validate_team(data["enemy_team"])

    return data


@app.route("/")
def index():
    return render_template("index.html")


PREANALYZED_PATH = os.path.join(BASE_DIR, "characters.json")


@app.route("/api/characters")
def get_characters():
    # 1) Try pre-analyzed JSON (created by AI from the image)
    if os.path.exists(PREANALYZED_PATH):
        with open(PREANALYZED_PATH) as f:
            data = json.load(f)
        return jsonify({"success": True, "data": data, "from_image": True})

    # 2) Try live Claude API analysis
    try:
        data = get_characters_from_image()
        # Cache for next request
        with open(PREANALYZED_PATH, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"success": True, "data": data, "from_image": True})
    except Exception as e:
        app.logger.error(f"Image analysis failed: {e}")
        return jsonify({"success": True, "data": FALLBACK_DATA, "from_image": False})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
