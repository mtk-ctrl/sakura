/* ============================================================
   Fewline Force vs Canine Coalition — Battle Game Engine
   ============================================================ */

// ── Character ─────────────────────────────────────────────────
class Character {
    constructor(d) {
        this.id      = d.id;
        this.name    = d.name;
        this.animal  = d.animal;
        this.cls     = d.class;
        this.emoji   = d.emoji || '⚔️';
        this.color   = d.color || '#888';
        this.hp      = d.hp;
        this.maxHp   = d.max_hp;
        this.mp      = d.mp;
        this.maxMp   = d.max_mp;
        this.atk     = d.atk;
        this.def     = d.def;
        this.spd     = d.spd;
        this.skills  = d.skills || [];
        this.isAlive = true;
        this.atkBuff = 0;
        this.defBuff = 0;
        this.evaBuff = 0;
    }
    get hpPct() { return (this.hp / this.maxHp) * 100; }
    get mpPct() { return (this.mp / this.maxMp) * 100; }

    takeDamage(raw) {
        if (!this.isAlive) return 0;
        if (this.evaBuff > 0 && Math.random() < 0.3) return -1; // evaded
        const defTotal = this.def + (this.defBuff > 0 ? 6 : 0);
        const reduced = Math.max(1, Math.floor(raw * (1 - defTotal * 0.022)));
        this.hp = Math.max(0, this.hp - reduced);
        if (this.hp === 0) this.isAlive = false;
        return reduced;
    }

    heal(amount) {
        const actual = Math.min(amount, this.maxHp - this.hp);
        this.hp += actual;
        return actual;
    }

    canUse(skill) { return this.mp >= (skill.mp_cost || 0); }

    spendMp(skill) { this.mp = Math.max(0, this.mp - (skill.mp_cost || 0)); }

    regenMp(n = 5) { this.mp = Math.min(this.maxMp, this.mp + n); }

    getAtk() { return this.atk * (this.atkBuff > 0 ? 1.5 : 1); }

    tickBuffs() {
        if (this.atkBuff > 0) this.atkBuff--;
        if (this.defBuff > 0) this.defBuff--;
        if (this.evaBuff > 0) this.evaBuff--;
    }
}

// ── Battle Engine ──────────────────────────────────────────────
class BattleEngine {
    static resolve(user, skill, targets) {
        const results = [];

        if (skill.type === 'support') {
            applyBuff(user, skill);
            results.push({ type: 'support', user, skill });
            return results;
        }

        if (skill.type === 'heal') {
            const amount = Math.abs(skill.damage || 35);
            const scaled = Math.floor(amount * (1 + (user.atk - 12) * 0.015));
            const target = targets[0];
            const actual = target.heal(scaled);
            results.push({ type: 'heal', user, target, amount: actual });
            return results;
        }

        // Damage
        const hits    = skill.hits || 1;
        const base    = skill.damage || 20;
        const atkMod  = user.getAtk() / 15;
        const mgcMod  = skill.type === 'magic' ? 1.12 : 1;

        for (const target of targets) {
            if (!target.isAlive) continue;
            let total = 0, crit = false;

            for (let i = 0; i < hits; i++) {
                const v = 0.85 + Math.random() * 0.3;
                const c = Math.random() < 0.12;
                if (c) crit = true;
                const raw = Math.floor(base * atkMod * mgcMod * v * (c ? 1.6 : 1));
                const dealt = target.takeDamage(raw);
                if (dealt === -1) {
                    results.push({ type: 'evade', user, target });
                    break;
                }
                total += dealt;
            }
            if (total > 0) {
                results.push({ type: 'damage', user, target, amount: total, crit, sType: skill.type });
            }
        }
        return results;
    }
}

function applyBuff(char, skill) {
    const n = (skill.name || '').toLowerCase();
    if (n.includes('guard') || n.includes('defense') || n.includes('fortress') || n.includes('iron')) {
        char.defBuff = 3;
    } else if (n.includes('evasion') || n.includes('smoke') || n.includes('dodge')) {
        char.evaBuff = 3;
    } else {
        char.atkBuff = 3;
    }
}

// ── Enemy AI ───────────────────────────────────────────────────
class AI {
    static act(enemy, allies, foes) {
        const aliveF = foes.filter(c => c.isAlive);
        if (!aliveF.length) return null;

        const weakFoe  = aliveF.reduce((a, b) => a.hpPct < b.hpPct ? a : b);
        const avail    = enemy.skills.filter(s => enemy.canUse(s));
        if (!avail.length) return null;

        // Low HP → prefer heal
        const healSkill = avail.find(s => s.type === 'heal');
        if (healSkill && enemy.hpPct < 0.4 && Math.random() < 0.7) {
            const lowestAlly = allies.filter(c => c.isAlive).reduce((a, b) => a.hpPct < b.hpPct ? a : b);
            return { skill: healSkill, targets: [lowestAlly] };
        }

        // Support buff
        const buffSkill = avail.find(s => s.type === 'support');
        if (buffSkill && Math.random() < 0.15) {
            return { skill: buffSkill, targets: [enemy] };
        }

        // Pick damage skill
        const dmg = avail.filter(s => s.type === 'physical' || s.type === 'magic');
        const chosen = (dmg.length && Math.random() < 0.7)
            ? dmg.reduce((a, b) => (a.damage || 0) > (b.damage || 0) ? a : b)
            : avail[Math.floor(Math.random() * avail.length)];

        const targets = (chosen.hits || 1) >= 3 ? aliveF : [weakFoe];
        return { skill: chosen, targets };
    }
}

// ── Main Game ──────────────────────────────────────────────────
class Game {
    constructor() {
        this.playerTeam  = [];
        this.enemyTeam   = [];
        this.selIdx      = 0;
        this.selSkillKey = null;
        this.combo       = 0;
        this.busy        = false;
        this.myTurn      = true;
        this.log         = [];
        this.teamData    = {};

        this._initLoading();
        this._load();
    }

    // ── Init / Load ─────────────────────────────────────────
    _initLoading() {
        let p = 0;
        const bar  = document.getElementById('loading-bar');
        const msgs = [
            'AI が画像を解析中...',
            'キャラクターを識別中...',
            'ステータスとスキルを生成中...',
            'バトルアリーナを準備中...',
            '戦闘開始！',
        ];
        let mi = 0;
        const st = document.getElementById('loading-status');

        this._loadTimer = setInterval(() => {
            if (!this._loaded) p = Math.min(p + Math.random() * 2.5, 88);
            else               p = 100;
            bar.style.width = p + '%';
            const ni = Math.min(Math.floor(p / 20), msgs.length - 1);
            if (ni !== mi) { mi = ni; st.textContent = msgs[mi]; }
            if (p >= 100) clearInterval(this._loadTimer);
        }, 220);
    }

    async _load() {
        try {
            const resp = await fetch('./characters.json');
            const raw  = await resp.json();
            // Support both flat JSON (GitHub Pages) and { success, data } wrapper (Flask API)
            const data = raw.player_team ? raw : raw.data;
            if (!data?.player_team) throw new Error('Invalid character data');

            this.teamData   = data;
            this.playerTeam = data.player_team.characters.map(c => new Character(c));
            this.enemyTeam  = data.enemy_team.characters.map(c => new Character(c));
            this._loaded = true;

            await new Promise(r => setTimeout(r, 400));

            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('game-screen').classList.remove('hidden');

            this._renderAll();
            this._setupInput();

            this._log('🤖 AI が画像からキャラクターを認識しました！', 'special');
            this._log('⚔️ バトル開始！ Fewline Force vs Canine Coalition!', 'special');
            this._log('🐱 キャラクター選択: 1〜5 キー or クリック　スキル: Q/W/E/R', 'system');

        } catch (e) {
            document.getElementById('loading-status').textContent = 'エラー: ' + e.message;
        }
    }

    // ── Rendering ───────────────────────────────────────────
    _renderAll() {
        document.getElementById('player-team-name').textContent =
            '🐱 ' + (this.teamData.player_team?.name || 'FEWLINE FORCE').toUpperCase();
        document.getElementById('enemy-team-name').textContent =
            '🐕 ' + (this.teamData.enemy_team?.name || 'CANINE COALITION').toUpperCase();

        this._renderPortraits('player-portraits', this.playerTeam, true);
        this._renderPortraits('enemy-portraits',  this.enemyTeam,  false);
        this._updateStatus();
        this._updateSkillBar();
        this._updateTurnText();
    }

    _renderPortraits(id, team, isPlayer) {
        const box = document.getElementById(id);
        box.innerHTML = '';
        team.forEach((ch, i) => {
            const el = document.createElement('div');
            el.className = 'portrait' +
                (ch === this._sel() ? ' selected' : '') +
                (ch.isAlive ? '' : ' dead');
            el.id = 'p-' + ch.id;
            el.dataset.idx  = i;
            el.dataset.side = isPlayer ? 'player' : 'enemy';

            const hpColor = isPlayer
                ? (ch.hpPct > 50 ? '#22dd44' : ch.hpPct > 25 ? '#ffaa00' : '#ff3333')
                : (ch.hpPct > 50 ? '#ff5533' : ch.hpPct > 25 ? '#ff8833' : '#cc1100');

            el.innerHTML = `
                <div class="portrait-icon" style="background:${ch.color}22;border-color:${ch.isAlive ? ch.color : '#333'}">
                    <span>${ch.emoji}</span>
                </div>
                <div class="portrait-hp">
                    <div class="portrait-hp-fill ${isPlayer ? 'p-hp-fill' : 'e-hp-fill'}"
                         style="width:${ch.hpPct}%;background:${hpColor}"></div>
                </div>
                <div class="portrait-name">${ch.name}</div>`;

            if (isPlayer) {
                el.addEventListener('click', () => {
                    if (ch.isAlive && this.myTurn && !this.busy) this._selectChar(i);
                });
            } else {
                el.addEventListener('click', () => {
                    if (ch.isAlive && this.myTurn && !this.busy && this.selSkillKey)
                        this._execAction([ch]);
                });
            }
            box.appendChild(el);
        });
    }

    _refreshPortrait(ch) {
        const el = document.getElementById('p-' + ch.id);
        if (!el) return;
        const isP = this.playerTeam.includes(ch);
        const hpFill = el.querySelector('.portrait-hp-fill');
        const hpColor = isP
            ? (ch.hpPct > 50 ? '#22dd44' : ch.hpPct > 25 ? '#ffaa00' : '#ff3333')
            : (ch.hpPct > 50 ? '#ff5533' : ch.hpPct > 25 ? '#ff8833' : '#cc1100');
        if (hpFill) { hpFill.style.width = ch.hpPct + '%'; hpFill.style.background = hpColor; }
        if (!ch.isAlive) el.classList.add('dead');
    }

    _updateStatus() {
        const ch = this._sel();
        if (!ch) return;
        document.getElementById('char-name').textContent = ch.name;
        document.getElementById('char-class').textContent = ch.animal + ' · ' + ch.cls;

        const hpBar = document.getElementById('hp-bar');
        hpBar.style.width = ch.hpPct + '%';
        hpBar.className = 'bar hp-bar' + (ch.hpPct < 25 ? ' low' : '');
        document.getElementById('hp-text').textContent = `${ch.hp}/${ch.maxHp}`;

        document.getElementById('mp-bar').style.width = ch.mpPct + '%';
        document.getElementById('mp-text').textContent = `${ch.mp}/${ch.maxMp}`;
    }

    _updateSkillBar() {
        const ch = this._sel();
        ['Q', 'W', 'E', 'R'].forEach((k, i) => {
            const btn   = document.getElementById('skill-' + k);
            const skill = ch?.skills?.[i];
            if (!skill) {
                btn.querySelector('.skill-name').textContent = '—';
                btn.querySelector('.skill-mp').textContent   = '';
                btn.className = 'skill-btn off';
                return;
            }
            btn.querySelector('.skill-name').textContent = skill.name;
            btn.querySelector('.skill-mp').textContent   = skill.mp_cost > 0 ? skill.mp_cost + ' MP' : 'Free';
            btn.title     = skill.description || skill.name;
            const canUse  = ch && ch.canUse(skill);
            const active  = this.selSkillKey === k;
            btn.className = 'skill-btn' + (!canUse ? ' off' : active ? ' on' : '');
        });
    }

    _updateCombo(delta) {
        this.combo = Math.max(0, Math.min(5, this.combo + delta));
        document.getElementById('combo-count').textContent = 'x' + this.combo;
        for (let i = 1; i <= 5; i++)
            document.getElementById('pip-' + i).className = 'pip' + (i <= this.combo ? ' on' : '');
    }

    _updateTurnText() {
        const el = document.getElementById('turn-text');
        if (this.myTurn) {
            el.className = '';
            const ch = this._sel();
            if (!ch || !ch.isAlive)
                el.textContent = 'キャラクターを選択 (1〜5 キー or クリック)';
            else if (!this.selSkillKey)
                el.textContent = `${ch.name} 選択中 → スキルを選んで！ (Q/W/E/R)`;
            else {
                const sk = this._getSkill();
                el.textContent = `${ch.name}: ${sk?.name} → 敵をクリック or Enter で攻撃！`;
            }
        } else {
            el.className = 'enemy';
            el.textContent = '敵のターン...';
        }
    }

    _log(msg, type = '') {
        this.log.push({ msg, type });
        if (this.log.length > 8) this.log.shift();
        const box = document.getElementById('battle-messages');
        box.innerHTML = this.log.map(l => `<div class="log-msg ${l.type}">${l.msg}</div>`).join('');
        document.getElementById('battle-log').scrollTop = 9999;
    }

    _floatDmg(charId, text, cssClass) {
        const el = document.getElementById('p-' + charId);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const f = document.createElement('div');
        f.className = 'dmg-float ' + cssClass;
        f.textContent = text;
        f.style.left = (r.left + r.width / 2 - 20) + 'px';
        f.style.top  = (r.top - 10) + 'px';
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 1500);
    }

    // ── Input ────────────────────────────────────────────────
    _setupInput() {
        document.addEventListener('keydown', e => {
            if (!this.myTurn || this.busy) return;
            const k = e.key.toUpperCase();
            if ('12345'.includes(e.key)) {
                const i = parseInt(e.key) - 1;
                if (i < this.playerTeam.length && this.playerTeam[i].isAlive) this._selectChar(i);
            } else if ('QWER'.includes(k)) {
                e.preventDefault();
                this._selectSkill(k);
            } else if (e.key === 'Enter' && this.selSkillKey) {
                const t = this._autoTarget();
                if (t) this._execAction([t]);
            }
        });

        ['Q', 'W', 'E', 'R'].forEach(k => {
            document.getElementById('skill-' + k).addEventListener('click', () => {
                if (!this.myTurn || this.busy) return;
                this._selectSkill(k);
                // auto-execute after brief delay so UI updates first
                setTimeout(() => {
                    if (this.selSkillKey !== k) return;
                    const sk = this._getSkill();
                    if (!sk) return;
                    if (sk.type === 'support') {
                        this._execAction([this._sel()]);
                    } else if (sk.type === 'heal') {
                        this._execAction([this._weakestAlly()]);
                    } else if ((sk.hits || 1) >= 3) {
                        this._execAction(this.enemyTeam.filter(e => e.isAlive));
                    } else {
                        const t = this._autoTarget();
                        if (t) this._execAction([t]);
                    }
                }, 60);
            });
        });
    }

    _sel()           { return this.playerTeam[this.selIdx] || null; }
    _getSkill()      {
        if (!this.selSkillKey) return null;
        return this._sel()?.skills[{ Q:0,W:1,E:2,R:3 }[this.selSkillKey]] || null;
    }
    _autoTarget()    { return this.enemyTeam.filter(e => e.isAlive).reduce((a, b) => a.hpPct < b.hpPct ? a : b, null); }
    _weakestAlly()   { return this.playerTeam.filter(c => c.isAlive).reduce((a, b) => a.hpPct < b.hpPct ? a : b); }

    _selectChar(i) {
        this.selIdx      = i;
        this.selSkillKey = null;
        document.querySelectorAll('.portrait[data-side="player"]').forEach(el => {
            el.classList.toggle('selected', parseInt(el.dataset.idx) === i);
        });
        this._updateStatus();
        this._updateSkillBar();
        this._updateTurnText();
    }

    _selectSkill(k) {
        const ch = this._sel();
        if (!ch?.isAlive) { this._log('先にキャラクターを選んで！', 'system'); return; }
        const sk = ch.skills[{ Q:0,W:1,E:2,R:3 }[k]];
        if (!sk) return;
        if (!ch.canUse(sk)) { this._log(`MP不足: ${sk.name} (必要 ${sk.mp_cost} MP)`, 'system'); return; }
        this.selSkillKey = k;
        this._updateSkillBar();
        this._updateTurnText();
    }

    // ── Animation helpers ────────────────────────────────────
    async _animAttack(attacker, targets) {
        const ae = document.getElementById('p-' + attacker.id);
        if (ae) {
            ae.querySelector('.portrait-icon').classList.add('anim-attack');
            await delay(280);
        }
        for (const t of targets) {
            const te = document.getElementById('p-' + t.id);
            if (te) te.querySelector('.portrait-icon').classList.add('anim-hit');
        }
        await delay(320);
        if (ae) ae.querySelector('.portrait-icon').classList.remove('anim-attack');
        for (const t of targets) {
            const te = document.getElementById('p-' + t.id);
            if (te) te.querySelector('.portrait-icon').classList.remove('anim-hit');
        }
    }

    // ── Execute player action ────────────────────────────────
    async _execAction(targets) {
        const ch = this._sel();
        const sk = this._getSkill();
        if (!ch?.isAlive || !sk || !this.myTurn || this.busy) return;

        this.busy = true;
        await this._animAttack(ch, targets);

        const results = BattleEngine.resolve(ch, sk, targets);
        ch.spendMp(sk);

        let hits = 0;
        for (const r of results) {
            if (r.type === 'damage') {
                const cls = r.crit ? 'crit' : (r.sType === 'magic' ? 'magic' : 'phys');
                this._floatDmg(r.target.id, r.crit ? `💥${r.amount}!` : String(r.amount), cls);
                this._refreshPortrait(r.target);
                this._log(
                    `${ch.name} が ${sk.name} → ${r.target.name} に ${r.amount} ダメージ！` +
                    (r.crit ? ' 💥 クリティカル！' : ''), r.crit ? 'special' : 'dmg');
                if (!r.target.isAlive) this._log(`💀 ${r.target.name} が倒れた！`, 'special');
                hits++;
            } else if (r.type === 'heal') {
                this._floatDmg(r.target.id, '+' + r.amount, 'heal');
                this._refreshPortrait(r.target);
                this._log(`${ch.name} が ${sk.name} → ${r.target.name} の HP を ${r.amount} 回復！`, 'heal');
            } else if (r.type === 'support') {
                this._log(`${ch.name} が ${sk.name}！ バフ付与 (3ターン)`, 'system');
            } else if (r.type === 'evade') {
                this._floatDmg(r.target.id, 'EVADE!', 'evade');
                this._log(`${r.target.name} が回避！`, 'system');
            }
        }

        if (hits > 0) {
            this._updateCombo(hits);
            if (this.combo >= 5) this._log('🌟 MAX COMBO! x5', 'special');
        }

        ch.regenMp(3);
        this._updateStatus();

        if (this._checkEnd()) { this.busy = false; return; }

        this.selSkillKey = null;
        this.myTurn = false;
        this._updateSkillBar();
        this._updateTurnText();

        await delay(1100);
        await this._enemyTurn();
    }

    // ── Enemy turn ───────────────────────────────────────────
    async _enemyTurn() {
        const alive = this.enemyTeam.filter(e => e.isAlive);

        for (const enemy of alive) {
            if (!enemy.isAlive) continue;
            await delay(700);

            const action = AI.act(enemy, this.enemyTeam, this.playerTeam);
            if (!action) {
                enemy.regenMp(8);
                this._log(`${enemy.name} が MP を回復...`, 'system');
                continue;
            }

            const { skill, targets } = action;
            if (!enemy.canUse(skill)) {
                enemy.regenMp(8);
                this._log(`${enemy.name} が MP を回復...`, 'system');
                continue;
            }

            await this._animAttack(enemy, targets);

            const results = BattleEngine.resolve(enemy, skill, targets);
            enemy.spendMp(skill);
            enemy.regenMp(3);
            enemy.tickBuffs();

            for (const r of results) {
                if (r.type === 'damage') {
                    const cls = r.crit ? 'crit' : (r.sType === 'magic' ? 'magic' : 'phys');
                    this._floatDmg(r.target.id, r.crit ? `💥${r.amount}!` : String(r.amount), cls);
                    this._refreshPortrait(r.target);
                    this._updateStatus();
                    this._log(
                        `${enemy.name} が ${skill.name} → ${r.target.name} に ${r.amount} ダメージ！` +
                        (r.crit ? ' 💥 クリティカル！' : ''), r.crit ? 'special' : 'dmg');
                    if (!r.target.isAlive) {
                        this._log(`💀 ${r.target.name} が倒れた！`, 'special');
                        this._renderPortraits('player-portraits', this.playerTeam, true);
                    }
                    this._updateCombo(-1);
                } else if (r.type === 'heal') {
                    this._floatDmg(r.target.id, '+' + r.amount, 'heal');
                    this._refreshPortrait(r.target);
                    this._log(`${enemy.name} が ${skill.name} で ${r.amount} HP 回復！`, 'heal');
                } else if (r.type === 'support') {
                    this._log(`${enemy.name} が ${skill.name}！ バフ付与`, 'system');
                } else if (r.type === 'evade') {
                    this._log(`${r.target.name} が回避！`, 'system');
                }
            }

            if (this._checkEnd()) { this.busy = false; return; }
        }

        await delay(500);
        this.playerTeam.forEach(c => c.tickBuffs());
        this.myTurn = true;
        this.busy   = false;
        this._updateTurnText();

        // Auto-switch if selected char died
        if (!this._sel()?.isAlive) {
            const next = this.playerTeam.findIndex(c => c.isAlive);
            if (next !== -1) this._selectChar(next);
        }
    }

    // ── Win / Lose ───────────────────────────────────────────
    _checkEnd() {
        if (!this.playerTeam.some(c => c.isAlive)) {
            setTimeout(() => document.getElementById('defeat-screen').classList.remove('hidden'), 900);
            return true;
        }
        if (!this.enemyTeam.some(c => c.isAlive)) {
            setTimeout(() => document.getElementById('victory-screen').classList.remove('hidden'), 900);
            return true;
        }
        return false;
    }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
