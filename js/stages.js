/**
 * 第一大關【殖民衛星外環防衛線】1-1～1-5 關卡資料
 * 劇本來源：v3_劇本企劃/第一大關_1-1至1-3_劇本.md、第一大關_1-4至1-5_劇本.md（開發者已確認）
 *
 * 對話格式：['角色', '台詞']、{ n: '旁白／動作' }、{ place: '場景' }、{ sys: '系統訊息' }
 * 地圖字元：. 平地  f 森林  c 都市  m 山嶽  w 河川  s 宇宙  d 殘骸  # 要塞外壁
 * hooks：playerPhaseStart / enemyPhaseStart / enemyPhaseEnd / afterAction / onDamage / onDefeat / onEvade / interceptDeath
 */
'use strict';

const PROTAGONIST_LOSE = '極光鋼姬與轟天巨神同時被擊墜';

// 1-5 強制最後一擊（不論是誰把影蝠打到零血，或時間到了，都由蕾歐娜一刀斬下）
async function batFinale(G, crash) {
  const bat = G.unit('bat');
  const leona = G.units.find((u) => u.uid === 'leona');
  if (!bat) return;
  G.vars.finaleQueued = true;
  if (!crash) G.award(500, '擊落影蝠');   // v14：BOSS 經驗由劇情發（影蝠一定被劇情保住，引擎那邊發不出去）
  if (crash) await G.talk([
    { n: '（跳躍倒數歸零的前一刻，影蝠的推進器全開。機體已經失控，全速撞向昭明號——）' },
    ['諾亞', '停下來……停下來啊！昭明號，給我停下來！'],
  ]);
  else await G.talk([
    { n: '（影蝠冒出黑煙，卻沒有墜落。失控的機體帶著殘存的推進力，全速撞向昭明號——）' },
    ['諾亞', '機體……不聽使喚了……！'],
  ]);
  await G.talk([
    { n: '（畫面切入極光鋼姬的駕駛艙。不論怎麼操作，蕾歐娜都擋在了昭明號前面。）' },
    ['蕾歐娜', '諾亞————！！'],
    ['諾亞', '老姊……'],
  ]);
  if (G.animOn && leona) await G.playAnim(leona, bat, UNIT_TYPES.AURORA.weapons[2], null, { line: '諾亞————！！', stopAt: 7.1 });
  await G.talk([{ n: '（光刀斬過。時間靜止。影蝠被斬開，以慢動作漂離。）' }]);
  if (G.flags.NOAH_HEARD_SISTER) {
    await G.talk([
      ['諾亞', '……老姊的聲音……我聽見了……'],
      ['諾亞', '煎蛋……要記得……吃……'],
      { n: '（影蝠的手伸向極光鋼姬。在碰到之前，爆炸了。）' },
    ]);
  } else {
    await G.talk([
      { n: '（通信只剩下雜訊。）' },
      { n: '（影蝠沒有任何回應，安靜地爆炸了。）' },
    ]);
  }
  bat.hp = 0; G.vars.batDown = true; G.render();
}

const STAGES = [
  // ════════════════════════════ 1-1 ════════════════════════════
  {
    id: '1-1', title: '拂曉的火光',
    win: '全滅敵機', lose: '極光鋼姬被擊墜／避難所被攻擊 3 次',
    map: [
      'cccc..cccc..cccc.....wwcc',
      'c..c..c..c..c..c....fwwcc',
      'cccc..cccc..cccc..f..ww..',
      '..................cc.ww..',
      '..............ccc....ww..',
      'ccc..ff..ccc..c.c....ww..',
      'c.c..fff.c.c..ccc....ww..',
      'ccc..ff..ccc.............',
      '..............ff.....ww..',
      '.ff...........ff.cc..ww.c',
      '......cc.........cc.ww..c',
      '...cc.cc...cc.......ww..c',
      '...cc......cc..fff..ww...',
      '.........cc....fff..ww.ff',
      'ccc....ffcc.....f...ww.ff',
      'c.c....ff...........ww...',
      'ccc........ccc...........',
      '.....ff....ccc......ww...',
      '....ff...........cc..ww..',
      'cc..ff.ccc.......cc..ww..',
      'cc.........ff....cc..wwcc',
      '...cc.........cc.....wwcc',
      '.c.cc.ccc.f..fcc.....ww..',
      '..cc..c.c.....cc...f.ww..',
      'c.cc..ccc............ww..',
    ],
    setup(G) {
      // v8 大地圖：25×25、開場敵機 4 → 10 台（住宅區 4、市中心 3、港口 3）
      G.spawn('AURORA', { uid: 'leona', team: 'player', x: 10, y: 20, protagonist: true });
      G.spawn('SHELTER', { uid: 'shelter', team: 'npc', x: 0, y: 24 });
      // 住宅區群（左上，r1、r2 第 2 回合會轉向避難所）
      G.spawn('E01', { uid: 'r1', x: 3, y: 9 });
      G.spawn('E01', { uid: 'r2', x: 6, y: 8 });
      G.spawn('E01', { x: 4, y: 6 }); G.spawn('E01', { x: 9, y: 9 });
      // 市中心群（正北）
      G.spawn('E01', { x: 12, y: 3 }); G.spawn('E01', { x: 15, y: 5 }); G.spawn('E01', { x: 11, y: 7 });
      // 港口群（右上，河川對岸）
      G.spawn('E01', { x: 23, y: 3 }); G.spawn('E01', { x: 24, y: 6 }); G.spawn('E01', { x: 19, y: 5 });
      G.vars.shelterHits = 0;
    },
    pre: [
      { place: '方舟三號・艾爾文家的小公寓，清晨。人造天空正在模擬日出。' },
      ['諾亞', '老姊——！再不起來，蛋要冷掉了！'],
      ['蕾歐娜', '……再五分鐘。'],
      ['諾亞', '妳每次說五分鐘都是三十分鐘。今天是妳第一次正式試乘吧？遲到的話，那台新機體就給我開。'],
      ['蕾歐娜', '想都別想。'],
      { n: '（餐桌上放著兩盤甜煎蛋，邊緣微焦。）' },
      ['蕾歐娜', '……又焦了。'],
      ['諾亞', '這叫「焦糖化」。媽的食譜就是這樣。'],
      ['蕾歐娜', '媽的才沒有焦。'],
      ['諾亞', '那是妳記憶美化。'],
      { n: '（兩人一起笑出來。電視新聞的聲音：「聯邦議會通過第四次殖民地特別稅……」）' },
      ['諾亞', '又加稅。下層區的配給已經減到一天兩餐了，妳知道嗎？隔壁的小米，昨天把她的麵包分給我。她才八歲。'],
      ['蕾歐娜', '諾亞……'],
      ['諾亞', '我知道、我知道，「這不是我們能改變的事」。快吃啦，測試員小姐。'],
      { n: '（出門前，蕾歐娜在門口停下。）' },
      ['蕾歐娜', '諾亞。測試員這份工作，我會做好。所以你不用去報名飛行學校。'],
      ['諾亞', '……知道啦。回來要吃晚餐喔。'],
      ['蕾歐娜', '嗯，回來要吃。'],
      { place: '港灣區研究所。爆炸聲。警報響起。' },
      ['廣播', '警告！所屬不明機甲部隊入侵港灣區！全體居民請前往避難所！'],
      ['研究員', '艾爾文！極光鋼姬可以動！快上去！'],
      ['蕾歐娜', '可是我只做過模擬——'],
      ['研究員', '現在全衛星只有妳能開它！'],
      { n: '（蕾歐娜登上極光鋼姬。駕駛艙亮起，白、淡青、海軍藍的機體站起。）' },
      ['蕾歐娜', '……極光鋼姬，啟動。'],
    ],
    hooks: {
      async playerPhaseStart(G) {
        if (G.turn === 1) {
          await G.talk([
            ['諾亞', '老姊！聽得到嗎？我在下層區的避難所，這裡的監視器還能用！'],
            ['蕾歐娜', '諾亞！？你怎麼會在那裡——快躲好！'],
            ['諾亞', '我在帶小孩們躲進去啦！聽著，敵人有十台，住宅區四台、市中心三台、港口三台。住宅區那幾台離避難所最近，先打那邊！'],
            ['蕾歐娜', '……知道了。你給我躲好！'],
            { sys: '操作：點極光鋼姬 → 點綠色格子移動 → 選「攻擊」→ 右側選武器 → 點紅色範圍內的敵機。右鍵或 Esc 取消。' },
          ]);
        }
        if (G.turn === 2) {
          for (const id of ['r1', 'r2']) { const u = G.unit(id); if (u) u.ai.hitsNpc = true; }
          await G.talk([
            ['諾亞', '左上那兩台轉向避難所了！它們的機槍打得到三格，火箭彈打得到四格，別讓它們靠近！'],
            { sys: '左下角的避難所被攻擊 3 次就會作戰失敗。' },
          ]);
        }
        if (G.turn === 3) {
          // v8：增援 2 → 5 台，一樣從右上角港口方向出現
          for (const [x, y] of [[24, 0], [24, 3], [19, 0], [24, 7], [16, 2]]) G.spawn('E01', G.freeCell(x, y));
          G.vars.wave3 = true; G.render();
          await G.talk([
            ['諾亞', '又來五台！……那是什麼？它們沒有駕駛員訊號……是無人機？'],
            ['黑曜突擊兵', '【機械合成語音】目標確認。回收對象：原初神鋼。排除障礙。'],
          ]);
        }
      },
      async afterAction(G, u) {
        const sh = G.unit('shelter');
        if (u.team === 'enemy' && G.near(u, sh, 4) && G.once('mi')) {
          await G.talk([
            ['小米', '諾亞哥哥……好可怕……'],
            ['諾亞', '沒事的，小米。妳看外面那台白色的，那是我老姊。她超強的。'],
            ['蕾歐娜', '……別隨便替我吹牛啊。'],
          ]);
        }
      },
      async onDamage(G, def) {
        if (def.uid === 'shelter') {
          G.vars.shelterHits += 1;
          def.hp = def.maxHp;
          G.log(`⚠️ 避難所被攻擊！（${G.vars.shelterHits}/3）`, 'enemy');
          if (G.vars.shelterHits < 3) G.later(() => G.talk([['諾亞', G.vars.shelterHits === 1 ? '避難所被打中了！小孩們在哭……老姊，拜託！' : '再一次……外牆撐不住了！']]));
        }
      },
    },
    victory: (G) => G.vars.wave3 && G.enemiesLeft() === 0,
    defeat: (G) => G.protagonistsDown() || G.vars.shelterHits >= 3,
    post: [
      ['蕾歐娜', '……結束了？'],
      ['諾亞', '老姊！妳超帥的！比模擬器裡的我還帥！'],
      ['蕾歐娜', '你剛剛說什麼模擬器？'],
      ['諾亞', '……沒事！'],
      { place: '避難所外。孩子們圍著蕾歐娜。' },
      ['小米', '姊姊，謝謝妳！'],
      ['蕾歐娜', '要謝的話，謝妳諾亞哥哥。是他帶你們躲進來的。'],
      ['諾亞', '我只是在旁邊亂喊而已啦。'],
      { n: '（遠處，聯邦駐軍的機體這時才姍姍來遲。）' },
      ['聯邦士官', '研究所的機體已經安全了嗎？很好。民眾的損害之後再統計。'],
      ['諾亞', '……「之後再統計」。他們先問的是機體。'],
      ['蕾歐娜', '諾亞。'],
      ['諾亞', '我沒事。……回家吧，晚餐我做。'],
      { n: '（港灣外的殘骸帶裡，一架黑色可變戰鬥機的剪影安靜地掉頭離開。）' },
    ],
  },

  // ════════════════════════════ 1-2 ════════════════════════════
  {
    id: '1-2', title: '鋼之巨神甦醒',
    win: '全滅敵機', lose: '轟天巨神登場前：極光鋼姬被擊墜／登場後：' + PROTAGONIST_LOSE,
    map: [
      'mmmmmmmmmmmmmmmmmmmmmmmmm',
      'mmmm.....mmmmm.......mmmm',
      'mm.......ff.............m',
      'mm.......ff.............m',
      'mm...mm..ff......mm..f..m',
      'mm...mm..........mm.....m',
      'mm...............mm.....m',
      'm.............ff........m',
      'm...m...................m',
      'm..mmmm.mmmm.........m..m',
      'm.........m...........m.m',
      'm.fff..............ff...m',
      'm.fff......cccc....ff...m',
      'm.fff.f...cccc..........m',
      'm...........c.......m...m',
      'm..mm.........mmm..mmm..m',
      'm..mm..........m........m',
      'm..mm...................m',
      'm......................mm',
      'm.......m......ff......mm',
      'm.ff........mm.ff......mm',
      'm......fff.....ff...ff.mm',
      'm......fff.............mm',
      'm......................mm',
      'mmm...............mmmmmmm',
    ],
    setup(G) {
      // v8 大地圖：25×25、開場敵機 4 → 10 台（山脊南側 4、東側 3、北側礦場 3）
      G.spawn('AURORA', { uid: 'leona', team: 'player', x: 5, y: 21, protagonist: true });
      G.spawn('HIBARI', { uid: 'noah', team: 'player', x: 6, y: 23 });
      G.spawn('E01', { x: 8, y: 12 }); G.spawn('E01', { x: 5, y: 11 }); G.spawn('E01', { x: 10, y: 11 }); G.spawn('E01', { x: 7, y: 13 });
      G.spawn('E01', { x: 20, y: 8 }); G.spawn('E01', { x: 22, y: 12 }); G.spawn('E01', { x: 18, y: 10 });
      G.spawn('E01', { x: 12, y: 4 }); G.spawn('E01', { x: 15, y: 3 }); G.spawn('E01', { x: 7, y: 3 });
    },
    pre: [
      { place: '1-1 隔天，研究所會議室。' },
      ['神城 玄藏', '昨天襲擊的目標，是地下封存的「原初神鋼」，也就是轟天巨神的心臟。'],
      ['蕾歐娜', '轟天巨神？'],
      ['神城 玄藏', '另一台機體。駕駛員是我兒子……本來應該是我的長子剛，但他三年前離開了。現在是二兒子甲斐。'],
      ['甲斐', '所以我是「備用的」。老爸不用每次都強調。'],
      ['神城 玄藏', '甲斐。'],
      ['甲斐', '……我去整備了。'],
      { place: '機庫走廊。諾亞追了出去。' },
      ['諾亞', '欸，等一下！你也是弟弟？'],
      ['甲斐', '……幹嘛？'],
      ['諾亞', '我也是。我老姊什麼都不讓我做，說是「為我好」。'],
      ['甲斐', '……我哥以前也這樣講。結果他自己一走了之。'],
      ['諾亞', '那我們都是被丟下的弟弟啊。握手？'],
      ['甲斐', '誰要跟你握手。'],
      { n: '（甲斐還是伸出了手。）' },
      { n: '（警報。地下研究所遭到攻擊。）' },
      ['諾亞', '老姊，我也去！採礦區的通道我最熟，我開作業機帶路！'],
      ['蕾歐娜', '不行！'],
      ['諾亞', '那妳一個人找得到研究所的入口嗎？'],
      ['蕾歐娜', '……'],
      ['諾亞', '我閃得很快的，妳知道。'],
      ['蕾歐娜', '……只帶路。看到敵人就退後。答應我。'],
      ['諾亞', '答應妳！'],
    ],
    hooks: {
      async playerPhaseStart(G) {
        if (G.turn === 1) await G.talk([
          ['諾亞', '跟著我！森林和山地比較好躲，那些大傢伙的子彈不容易打中！'],
          { sys: '客串機體：作業機「雲雀」（諾亞）。攻擊力低但非常會閃；「信號彈」命中後，對方下一次攻擊命中率 -30%。雲雀被擊墜不算失敗。' },
          { sys: '地形：森林、山嶽、都市有防禦與迴避加成（游標移到格子上可以看）。' },
        ]);
        if (G.turn === 2) {
          // v8：增援 1 → 3 台（赤炎斬擊者 ×2 追雲雀＋黑曜 ×1），從右上方出現
          G.spawn('E02', Object.assign(G.freeCell(22, 2), { ai: { prefer: 'HIBARI' } }));
          G.spawn('E02', Object.assign(G.freeCell(19, 2), { ai: { prefer: 'HIBARI' } }));
          G.spawn('E01', G.freeCell(23, 6)); G.render();
          await G.talk([
            ['赤炎斬擊者', '【機械合成語音】格鬥模組啟動。優先排除：高機動目標。'],
            ['蕾歐娜', '它在追諾亞——！'],
            { sys: '精神指令：右側面板可以使用。「必中」讓本回合攻擊必定命中，「閃躲」讓下一次被攻擊必定迴避。' },
          ]);
        }
        if (G.turn === 3) {
          await G.talk([
            ['神城 玄藏', '甲斐……轟天巨神的封印，我已經解開了……'],
            ['甲斐', '老爸！？你在哪——'],
            ['神城 玄藏', '聽好……這台機體不是武器……是「守護」……剛他……其實……'],
            { n: '（通信中斷。爆炸。）' },
            ['甲斐', '老爸——————！！'],
            { n: '（地面裂開，轟天巨神從地底升起。甲斐的吶喊與機體的咆哮重疊。）' },
            ['甲斐', '我不是備用的……我是神城甲斐！轟天巨神，給我站起來！'],
          ]);
          G.spawn('TITAN', Object.assign({ uid: 'kai', team: 'player', protagonist: true }, G.freeCell(12, 13)));   // 地圖中央的研究所
          G.vars.kaiIn = true; G.render();
          await G.talk([{ sys: '轟天巨神登場！超級系機體：HP 與裝甲很高，但運動性低、不太會閃。從現在起，兩台主角機同時被擊墜才算失敗。' }]);
        }
        if (G.turn === 4) {
          // v8：增援 黑曜 1 → 3、鐵甲犀牛 1 → 2（右下、右側）；民用機維持 1 台
          G.spawn('E01', G.freeCell(22, 20)); G.spawn('E01', G.freeCell(23, 17)); G.spawn('E01', G.freeCell(21, 23));
          G.spawn('CIVIL', Object.assign({ uid: 'civil' }, G.freeCell(14, 22)));
          G.spawn('E03', G.freeCell(22, 13)); G.spawn('E03', G.freeCell(22, 11));
          G.vars.wave4 = true; G.render();
          await G.talk([
            ['諾亞', '等一下！下面那台的識別碼是民用的！裡面有人！'],
            ['民用機駕駛', '控、控制不了……機體自己在動……！'],
            { sys: '新指令「說服」：蕾歐娜或諾亞移動到那台民用機旁邊（相鄰一格），選單會出現「說服」。' },
          ]);
        }
      },
      async onEvade(G, def) {
        if (def.uid === 'noah' && G.once('noahEvade')) G.later(() => G.talk([
          ['諾亞', '看到沒！老姊妳看到沒！我閃掉了！'],
          ['蕾歐娜', '不要邊閃邊回頭！'],
        ]));
      },
      async afterAction(G) {
        if (G.adjacent(G.unit('noah'), G.unit('kai')) && G.once('noahKai')) await G.talk([
          ['諾亞', '甲斐！你的老爸……'],
          ['甲斐', '別說了。先把這些傢伙打爛。'],
          ['諾亞', '……嗯！我幫你引開它們！'],
        ]);
      },
      async onDefeat(G, def) {
        if (def.uid === 'noah') G.later(() => G.talk([['諾亞', '可惡，雲雀撐不住了……老姊，我先退到礦道裡！'], { sys: '雲雀撤退（不算失敗）。' }]));
        if (def.uid === 'civil') G.later(() => G.talk([['蕾歐娜', '……裡面明明還有人。'], { sys: '提示：被入侵的民用機可以用「說服」讓它撤退。' }]));
      },
    },
    talks: [
      { from: 'leona', to: 'civil', once: true, async run(G) {
        await G.talk([
          ['蕾歐娜', '聽得到嗎？把主電源切掉！從駕駛艙後方的緊急拉桿！'],
          ['民用機駕駛', '拉、拉下來了……停了……機體停下來了！'],
          ['蕾歐娜', '很好，往後方的礦道撤退。'],
          { sys: '說服成功！民用機撤退了。' },
        ]);
        G.remove('civil'); G.award(100, '說服民用機');   // v14：說服才有經驗，打下來是 0
      } },
      { from: 'noah', to: 'civil', once: true, async run(G) {
        await G.talk([
          ['諾亞', '大叔，是我，常在三號礦坑打工的諾亞！駕駛座左下有一個紅色的拉桿，用力拉！'],
          ['民用機駕駛', '諾亞！？……好、好！停了！'],
          ['諾亞', '從右邊的礦道走，那邊安全！'],
          { sys: '說服成功！民用機撤退了。' },
        ]);
        G.remove('civil'); G.award(100, '說服民用機');   // v14：說服才有經驗，打下來是 0
      } },
    ],
    victory: (G) => G.vars.wave4 && G.enemiesLeft() === 0,
    defeat: (G) => G.protagonistsDown(),
    post: [
      { place: '研究所廢墟。玄藏的遺體被蓋上白布。' },
      { n: '（甲斐沉默地跪著。）' },
      ['蕾歐娜', '……甲斐。'],
      ['甲斐', '他最後想說的是剛的事。他說「剛他其實」……其實什麼啊，老爸。'],
      { n: '（諾亞站在遠處，看著聯邦軍的運輸機降落。）' },
      ['聯邦指揮官', '原初神鋼回收了嗎？很好。這座衛星的民眾撤離計畫，就不必執行了。'],
      ['副官', '長官，下層區還有三千人……'],
      ['聯邦指揮官', '本部的命令是保住機體。殖民衛星，再蓋就有。'],
      { n: '（諾亞全部聽見了。他的拳頭在發抖。）' },
      { place: '昭明號抵達，艦長瑪格麗特走下舷梯。' },
      ['瑪格麗特', '蕾歐娜、甲斐。好久不見，你們都長這麼大了。'],
      ['蕾歐娜', '瑪格麗特阿姨……？'],
      ['瑪格麗特', '我是昭明號的艦長。玄藏是我的老戰友……我來晚了。孩子們，從今天起，你們上我的船。'],
      ['瑪格麗特', '你是……諾亞？上次看到你，你還不會走路呢。'],
      ['諾亞', '……您好。'],
      { place: '夜晚，昭明號的觀景窗前。' },
      { n: '（諾亞獨自一人。終端機上收到一則匿名訊息。）' },
      ['訊息', '你今天聽見了吧。這個世界，只會保護機體，不會保護人。如果你想改變它，就來外環殘骸帶。——S'],
      { n: '（他看了很久，把終端機關掉。）' },
      ['蕾歐娜', '還不睡？'],
      ['諾亞', '……老姊，如果有一天，有一個方法可以讓小米她們不再挨餓，就算要做很危險的事，妳會去做嗎？'],
      ['蕾歐娜', '……我會先想辦法不讓你去做。'],
      ['諾亞', '果然是老姊會說的話。'],
    ],
  },

  // ════════════════════════════ 1-3 ════════════════════════════
  {
    id: '1-3', title: '孤星的攔截戰',
    win: '全滅敵機（影蝠除外）', lose: PROTAGONIST_LOSE,
    map: [
      'sssssssssssssssssssssssss',
      'ssssddsssssssssssssssssss',
      'ssssssssssssssssdsssssdss',
      'ssssssssdsssssdssssssssss',
      'sssssssdsssdssssssdssssss',
      'ssdsssdsssdssssssssssssss',
      'sssssssdsdsssssssssssssss',
      'ssssssssdsssssssdssssssss',
      'sdssdssssssssssdsdsssssss',
      'ssssssssssssssdddddsssdss',
      'sdssssssssssssssddsdsssss',
      'sssssssdsssssssssssssssss',
      'ssssssssdsdssssssssssddss',
      'sssssssssssssssssssssddss',
      'sssssssdsssdsssssssdsddss',
      'ssssssssssdddsssssssssssd',
      'sssssssssssdsssssssssssss',
      'sssssssssssssssssssssssss',
      'sssssssssdssssssddsssssss',
      'ssssssdssssssssdddsdsssss',
      'ssssssddssssssssdssdssdss',
      'dsssddssdssssssssdsssssds',
      'ssssssdssdssssdssdsssssds',
      'ssssssdsssssssssssssssdss',
      'ssdssdsssssssssdsssssssss',
    ],
    setup(G) {
      // v8 大地圖：25×25、開場敵機 5 → 12 台（黑曜 3→7、赤炎 2→5；中央 4、右上 4、右下 4）
      G.spawn('AURORA', { uid: 'leona', team: 'player', x: 2, y: 15, protagonist: true });
      G.spawn('TITAN', { uid: 'kai', team: 'player', x: 3, y: 18, protagonist: true });
      // 中央群
      G.spawn('E01', { x: 11, y: 9 }); G.spawn('E01', { x: 12, y: 18 }); G.spawn('E02', { x: 13, y: 14 }); G.spawn('E02', { x: 16, y: 12 });
      // 右上群
      G.spawn('E01', { x: 18, y: 4 }); G.spawn('E01', { x: 21, y: 6 }); G.spawn('E01', { x: 19, y: 8 }); G.spawn('E02', { x: 22, y: 3 });
      // 右下群
      G.spawn('E01', { x: 20, y: 20 }); G.spawn('E01', { x: 22, y: 22 }); G.spawn('E02', { x: 19, y: 23 }); G.spawn('E02', { x: 23, y: 18 });
      G.markers.push({ id: 'hibari', x: 12, y: 12, icon: '🛰️' });
    },
    pre: [
      { place: '昭明號・早晨。艾爾文姊弟的艙房。' },
      { n: '（餐桌上沒有煎蛋。只有一張紙條。）' },
      ['紙條', '老姊：今天沒有煎蛋了。對不起。我想去確認一件事。不要來找我。——諾亞'],
      ['蕾歐娜', '……那個笨蛋。'],
      { place: '艦橋。' },
      ['瑪格麗特', '作業機「雲雀」今天凌晨從機庫被開走了，方向是外環殘骸帶。'],
      ['甲斐', '他一個人去那種地方幹嘛！？'],
      ['蕾歐娜', '……昨天晚上，他問我一個奇怪的問題。我應該要聽他說完的。'],
      ['瑪格麗特', '蕾歐娜，冷靜。殘骸帶裡偵測到不明機體的訊號，可能是昨天那些無人機的母隊。'],
      ['蕾歐娜', '那我更要去。極光鋼姬，出擊。'],
      ['甲斐', '我也去。那傢伙……說我們都是被丟下的弟弟。我才不會丟下他。'],
    ],
    hooks: {
      async playerPhaseStart(G) {
        const bat = G.unit('bat');
        if (bat && G.turn >= 5 && !G.vars.batGone) G.later(() => batRetreat13(G));
        if (G.turn === 1) await G.talk([
          ['蕾歐娜', '諾亞！聽得到就回答我！'],
          { n: '（只有雜訊。）' },
          ['甲斐', '殘骸太多了，雷達很亂。小心伏擊！'],
          { sys: '宇宙地形：殘骸格有迴避 +20% 的掩護效果，但移動消耗 2。地圖中央有一個不明物體。' },
        ]);
        if (G.turn === 3) {
          G.spawn('E04', Object.assign({ uid: 'bat', ai: { only: 'player' } }, G.freeCell(22, 10)));   // v8：右側殘骸帶
          G.render();
          await G.talk([
            { n: '（黑色可變戰鬥機以音速穿過殘骸帶。它的閃避動作，和雲雀一模一樣。）' },
            ['蕾歐娜', '好快……！那個動作……'],
            ['影蝠', '離開這片空域。這裡不是聯邦的地盤。'],
            ['蕾歐娜', '……這個閃法。這個繞到右後方的習慣。諾亞……是你嗎？'],
            { n: '（停頓。變聲解除。）' },
            ['諾亞', '……別用那種聲音叫我。'],
            ['甲斐', '諾亞！？你在搞什麼——'],
            ['諾亞', '甲斐，你昨天也聽見了吧？「殖民衛星，再蓋就有」。你老爸為了保護那個研究所死了，聯邦卻只關心機體。'],
            ['甲斐', '……那也不代表你可以——'],
            ['諾亞', '可以什麼？可以不再被保護嗎？'],
          ]);
        }
      },
      async afterAction(G, u) {
        const m = G.markers.find((k) => k.id === 'hibari');
        if (u.team === 'player' && m && Math.abs(u.x - m.x) + Math.abs(u.y - m.y) <= 1 && G.once('hibari')) {
          await G.talk([
            ['蕾歐娜', '是雲雀……裡面沒有人。'],
            ['甲斐', '駕駛艙是從裡面打開的。他是自己離開的……'],
          ]);
        }
      },
      interceptDeath: (G, def) => def.uid === 'bat',
      async onDamage(G, def, att) {
        if (def.uid !== 'bat') return;
        if (G.once('batHit13')) G.later(() => G.talk(att && att.uid === 'leona'
          ? [['諾亞', '別勉強了，老姊！妳根本不想打我吧！'], ['蕾歐娜', '……我只是要把你從那台機體裡拉出來！']]
          : [['諾亞', '甲斐，別逼我！我不想跟你打！']]));
        if (def.hp <= def.maxHp * 0.3 && !G.vars.batGone && G.once('batRetreat')) { G.award(200, '逼退影蝠'); G.later(() => batRetreat13(G)); }   // v14
      },
    },
    talks: [
      { from: 'leona', to: 'bat', when: (G) => !G.flags.NOAH_TALK_13, async run(G) {
        G.flags.NOAH_TALK_13 = true;
        await G.talk([
          ['蕾歐娜', '諾亞，回來。我們回家，有什麼事都可以說——'],
          ['諾亞', '妳每次都這樣。「回家」、「危險」、「我來就好」。老姊，我不是要妳保護我。我是想要……跟妳站在一樣的地方。'],
          ['蕾歐娜', '……'],
          ['諾亞', '這台影蝠，是有人給我的「翅膀」。我第一次可以不用躲在妳後面。'],
        ]);
      } },
      { from: 'kai', to: 'bat', once: true, async run(G) {
        await G.talk([
          ['甲斐', '你說我們都是被丟下的弟弟。那你現在在幹嘛？你在丟下你老姊！'],
          ['諾亞', '……我沒有丟下她。我只是不想再站在她後面了。'],
        ]);
      } },
    ],
    victory: (G) => G.vars.batGone && G.enemiesLeft() === 0,
    defeat: (G) => G.protagonistsDown(),
    post: [
      { place: '昭明號機庫。蕾歐娜坐在極光鋼姬的腳邊，一動也不動。' },
      ['甲斐', '……喂。'],
      ['蕾歐娜', '他說，他想跟我站在一樣的地方。'],
      ['甲斐', '嗯。'],
      ['蕾歐娜', '我一直以為，不讓他上戰場就是保護他。結果是我把他推出去的。'],
      ['甲斐', '……我哥走的時候，我也這樣想過。「是不是我太沒用，他才不要我」。後來我想通了一件事。'],
      ['蕾歐娜', '什麼？'],
      ['甲斐', '不管他為什麼走，把他揍回來就對了。'],
      ['蕾歐娜', '……你這個人，真的很笨。'],
      ['甲斐', '彼此彼此。'],
      { place: '艦長室。' },
      { n: '（瑪格麗特看著一張舊照片：兩對年輕夫婦，抱著兩個嬰兒和一個小男孩。）' },
      ['瑪格麗特', '艾爾文、神城……你們的孩子，又要互相拿槍對著彼此了嗎。'],
      { place: '殘骸帶深處，敵方母艦。' },
      ['席格', '你做得很好，諾亞。今天你沒有開槍。'],
      ['諾亞', '……我下次也不會對她開槍。'],
      ['席格', '我知道。所以我從來沒有要你開槍。我要你讓她看見，你已經可以自己飛了。'],
      { n: '（諾亞獨自一人，打開終端機裡一張照片：姊弟兩人和一盤焦掉的煎蛋。）' },
    ],
  },

  // ════════════════════════════ 1-4 ════════════════════════════
  {
    id: '1-4', title: '背叛的防衛要塞',
    win: '破壞要塞砲台 ×3', lose: PROTAGONIST_LOSE,
    map: [
      '##############################',
      '##############################',
      '########ss##########ss########',
      'ss#sss#ssssss#sss#sssss#sss#ss',
      'ssssssssssssssssssssssssssssss',
      'ssssssssdsssssssdsssssssssssss',
      'ssssssssssssssdsssssssssssssss',
      'ssssssssssssssdsssssssdssdssss',
      'sssddsssss##ssssss##ssssssssss',
      'ssdsssssss##ssssss##ssdssssssd',
      'ssssssdddssssssssssssdsdssssss',
      'sssssddsddsssssssssssddsdssssd',
      'ssssssssdsssdssssssssdddssssds',
      'ss##sssdssssssssssssssdsss##ss',
      'ssssssssssssssssssssssssssssss',
      'ssssdssssssssdsssssssssssdssss',
      'sssssssssddsssssssssssssssssss',
      'sssssssssdsssddsssssssssssssss',
      'ssssdsssssssddddsssssdssssssss',
      'ssssssssssssssddssssssssssdsss',
      'dssssdssdsssssssssssssssssssss',
      'ssssddddsssssssssdsssssdsdsssd',
      'sssssdssssssdsdssssssssdssdssd',
      'ssssdsssssssssssssssdssssdssss',
      'ssssssssssssssssssssssssssssss',
      'sssssssssssssdsssdssssssssssss',
      'ssssssssssssssssssdsssssssssss',
      'ssssssssssssssssssssssssssssss',
      'ssssssssssdsssssssssssssssssss',
      'ssssssssssssssssssssssssssssss',
    ],
    setup(G) {
      // v8 大地圖：30×30（外壁 0～2 列、閘口 2 處、砲台在第 3 列）、開場敵機 8 → 18 台（砲台 3 座不變）
      G.spawn('AURORA', { uid: 'leona', team: 'player', x: 3, y: 26, protagonist: true });
      G.spawn('TITAN', { uid: 'kai', team: 'player', x: 5, y: 28, protagonist: true });
      G.spawn('SHOMEI', { uid: 'shomei', team: 'npc', x: 26, y: 28, untargetable: true });
      G.spawn('TURRET', { uid: 't1', x: 4, y: 3 }); G.spawn('TURRET', { uid: 't2', x: 15, y: 3 }); G.spawn('TURRET', { uid: 't3', x: 25, y: 3 });
      // 黑曜 4 → 9（左翼 3、中央 3、右翼 3）
      G.spawn('E01', { x: 3, y: 10 }); G.spawn('E01', { x: 6, y: 14 }); G.spawn('E01', { x: 4, y: 17 });
      G.spawn('E01', { x: 12, y: 13 }); G.spawn('E01', { x: 16, y: 15 }); G.spawn('E01', { x: 14, y: 11 });
      G.spawn('E01', { x: 24, y: 10 }); G.spawn('E01', { x: 23, y: 15 }); G.spawn('E01', { x: 27, y: 17 });
      // 赤炎 2 → 5（砲台前方的第二道防線）
      G.spawn('E02', { x: 6, y: 7 }); G.spawn('E02', { x: 13, y: 7 }); G.spawn('E02', { x: 21, y: 7 }); G.spawn('E02', { x: 9, y: 12 }); G.spawn('E02', { x: 20, y: 12 });
      // 鐵甲犀牛 2 → 4（固守砲台旁）
      G.spawn('E03', { x: 5, y: 4, ai: { hold: true } }); G.spawn('E03', { x: 14, y: 4, ai: { hold: true } });
      G.spawn('E03', { x: 16, y: 4, ai: { hold: true } }); G.spawn('E03', { x: 24, y: 4, ai: { hold: true } });
      G.vars.turretsDown = 0;
    },
    pre: [
      { place: '昭明號艦橋。前方出現聯邦第七艦隊的旗艦與防衛要塞。' },
      ['通信士 遙', '艦長！第七艦隊發來通信，說要接收我們！'],
      ['瑪格麗特', '……第七艦隊的司令，是羅蘭・格雷少將吧。'],
      ['甲斐', '得救了嗎？'],
      ['瑪格麗特', '但願如此。'],
      ['格雷少將', '昭明號，辛苦了。請將極光鋼姬、轟天巨神與原初神鋼移交本艦隊。乘員將另行安置。'],
      ['瑪格麗特', '另行安置？方舟三號下層區還有三千名居民，第七艦隊的運輸艦什麼時候出發救援？'],
      ['格雷少將', '關於那件事——方舟三號的撤離計畫已經取消了。'],
      ['蕾歐娜', '取消……？'],
      ['格雷少將', '這座殖民衛星，本來就預定在今天「處理」掉。殖民地叛亂分子的據點，只要說是被異星勢力摧毀就好。'],
      ['甲斐', '你說什麼——！'],
      ['格雷少將', '順帶一提，前天襲擊研究所的黑曜部隊，是本艦隊的無人機。原初神鋼，聯邦要用「正當的方式」取得。所以，請把機體交出來。否則，昭明號也會變成「被異星勢力擊沉的船」。'],
      { n: '（通信切斷。要塞的砲口全部轉向昭明號。）' },
      ['蕾歐娜', '……諾亞說的，全部都是真的。'],
      ['瑪格麗特', '全艦戰鬥配置！蕾歐娜、甲斐，破壞要塞砲台，打開脫離路線！'],
      ['甲斐', '老爸就是被這種人害死的……我一拳一拳打爆它們！'],
    ],
    hooks: {
      async playerPhaseStart(G) {
        if (G.turn % 2 === 1) {   // 奇數回合：預告重砲發射線（極光鋼姬所在的那一直排）
          const target = G.unit('leona') || G.unit('kai');
          if (target) {
            const cells = []; for (let y = 3; y < G.rows; y++) cells.push({ x: target.x, y });   // v8：外壁改為 0～2 列，發射線從第 3 列（砲台列）開始
            G.telegraph = { cells, fireTurn: G.turn };
          }
        }
        if (G.turn === 1) await G.talk([
          ['瑪格麗特', '要塞重砲的發射線會提前顯示！看到紅色的那一排，就給我閃開！'],
          { sys: '要塞重砲：紅色閃爍的直排，會在本回合的敵方回合開始時被轟擊（3500 傷害）。請在我方回合移開。' },
        ]);
        if (G.turn === 4) {
          // v8：增援 3 → 7 台，從左右兩側邊緣出現
          for (const [x, y] of [[0, 12], [0, 15], [0, 18], [0, 21], [29, 15], [29, 18], [29, 21]]) G.spawn('E01', G.freeCell(x, y));
          G.render();
          await G.talk([
            ['通信士 遙', '後方出現增援！是黑曜型！數量七！'],
            ['甲斐', '又是那些無人機……原來從頭到尾都是你們！'],
          ]);
        }
      },
      async enemyPhaseStart(G) {
        const tg = G.telegraph;
        if (!tg || tg.fireTurn !== G.turn) return;
        if (G.turn === 5 && G.once('batSave')) {
          const leona = G.unit('leona');
          if (leona) {
            G.spawn('E04', Object.assign({ uid: 'bat14', team: 'neutral', untargetable: true }, G.freeCell(leona.x + 1, leona.y)));
            G.render();
            await G.talk([
              { n: '（要塞重砲第五次充能，發射線正好鎖定極光鋼姬。）' },
              ['蕾歐娜', '來不及閃——！'],
              { n: '（一架黑色戰鬥機以音速切入，對著要塞砲口發射全部導彈。砲口爆炸，發射中止。）' },
              ['蕾歐娜', '……影蝠！？'],
              ['諾亞', '我說過，我不會對妳開槍。'],
              ['蕾歐娜', '諾亞……'],
              ['諾亞', '我可沒說不會對他們開槍。老姊，妳看見了吧？這就是妳在保護的「聯邦」。'],
              ['蕾歐娜', '我看見了。所以我要保護的不是聯邦——'],
              ['諾亞', '……那妳在保護什麼？'],
              { n: '（蕾歐娜答不出來。）' },
              ['席格', '諾亞，回來。這不是你的任務。'],
              ['諾亞', '……是。老姊，下次見面的時候，給我一個答案。'],
            ]);
            G.remove('bat14'); G.telegraph = null;
            return;
          }
        }
        G.telegraph = null;
        await G.banner('要塞重砲 發射', '', 700);
        for (const c of tg.cells) { const u = G.alive((x) => x.x === c.x && x.y === c.y && x.kind === 'unit')[0]; if (u) await G.directDamage(u, 3500, '要塞重砲'); }
        G.render();
      },
      async onDefeat(G, def, att) {
        if (def.type !== 'TURRET') return;
        G.vars.turretsDown += 1;
        if (G.vars.turretsDown === 1) G.later(() => G.talk([
          ['格雷少將', '愚蠢。你們以為自己在保護誰？那座衛星的人，聯邦早就不要了。'],
          ['蕾歐娜', '……聯邦不要，我要。'],
        ]));
        if (G.vars.turretsDown === 3 && att && att.uid === 'leona') G.later(() => G.talk([
          ['蕾歐娜', '我要保護的……是那些人，還有你。'],
          ['蕾歐娜', '……這個答案，我下次一定要說給你聽。'],
        ]));
      },
    },
    victory: (G) => G.alive((u) => u.type === 'TURRET').length === 0,
    defeat: (G) => G.protagonistsDown(),
    post: [
      ['瑪格麗特', '脫離路線打開了！昭明號全速前進！'],
      ['格雷少將', '……追擊。不准讓原初神鋼離開這片空域。'],
      { place: '昭明號・作戰會議室。全員到齊，氣氛沉重。' },
      ['瑪格麗特', '我們現在是聯邦的叛軍了。'],
      ['甲斐', '我無所謂。是他們先背叛的。'],
      ['瑪格麗特', '接下來，我們要做一件很瘋狂的事：在方舟三號被「處理」之前，啟動昭明號的亞光速跳躍，帶著下層區的避難船一起逃往地球。'],
      ['通信士 遙', '跳躍需要 5 分鐘充能。這段時間，昭明號完全沒有防禦。'],
      ['瑪格麗特', '所以，要拜託你們兩個守住這 5 分鐘。'],
      { place: '機庫。蕾歐娜看著極光鋼姬。瑪格麗特走過來。' },
      ['瑪格麗特', '他今天救了妳。'],
      ['蕾歐娜', '……嗯。'],
      ['瑪格麗特', '蕾歐娜，阿姨跟妳說一件事。妳媽媽以前也是這樣，什麼都想自己扛。妳爸爸說過一句話，我一直記得。'],
      ['蕾歐娜', '什麼話？'],
      ['瑪格麗特', '「被保護的人，有時候最想要的不是被保護，是被看見。」'],
      { n: '（蕾歐娜愣住。）' },
      ['瑪格麗特', '下次見到他，別再叫他回家了。先聽他想要什麼，告訴他妳看見了什麼。'],
      { place: '敵方母艦。' },
      ['席格', '為什麼違抗命令？'],
      ['諾亞', '……因為她差點死了。'],
      ['席格', '你救了她，她就會跟你走嗎？'],
      ['諾亞', '……'],
      ['席格', '下一次，昭明號會在跳躍前停住 5 分鐘。上面要我們阻止跳躍、回收原初神鋼。我會把這個任務交給你。'],
      ['諾亞', '我？'],
      ['席格', '你想讓她看見你已經可以自己飛了，對吧。那就去讓她看。……只是，不要死。'],
    ],
  },

  // ════════════════════════════ 1-5 ════════════════════════════
  {
    id: '1-5', title: '突破！死線跳躍',
    win: '擊墜影蝠戰鬥機', lose: PROTAGONIST_LOSE + '／昭明號或避難船被擊沉',
    map: [
      'ssssssssssssssssssssssssdsssss',
      'sdssssssssssssssdsssssssssssss',
      'sssssssssssssssssssssssdssssss',
      'ssssssssssdsdsssssssssssddssss',
      'ssssssssssssddsssssssdsdsdddds',
      'dsssssssssdddddssdssssssdsdsss',
      'ssssssssdssdddsssssssssssdssss',
      'sssssssssssdssssdsssssssssssss',
      'ssssssssssdsssssssssdsssssssss',
      'sssssssssssdsssssssdddssssssss',
      'sssssssssssssssssssdssssssdsss',
      'ssssssssssssssssssssssssdsssds',
      'ssssssssssdsssssssssssssssdsss',
      'sssssssssssssssdsssssssssdssss',
      'ssssssssssssdsdsdsssssssssdsss',
      'sssssssssssdssdssssdssssssssss',
      'sssssssssssdsssssssssdssssssss',
      'ssssssssssssssssssddssssssssss',
      'ssssssssssssssssssssssssssssss',
      'ssssssssssssssssssssdsssssssss',
      'sssssssssssssssdssddddssssssss',
      'sssssssssssssdssssdsdssssdssss',
      'ssssssssssssssssssssssssssssss',
      'ssssssssdsssdddsssdsssssssssss',
      'ssssssssdssdssddssdssssssdssss',
      'ssssssssdsssdddsssssssdddddsds',
      'ssssdssssssssdssssssssssddddss',
      'ssssssssssssssssssssssssdsssss',
      'sssssssssssssssssssssssssdssss',
      'sssssssssssdsssssssssdssssssss',
    ],
    setup(G) {
      // v8 大地圖：30×30、開場敵機 7 → 17 台（影蝠 BOSS 1 台不變）
      G.spawn('SHOMEI', { uid: 'shomei', team: 'npc', x: 2, y: 14 });
      G.spawn('EVAC', { uid: 'evac1', team: 'npc', x: 2, y: 10 });
      G.spawn('EVAC', { uid: 'evac2', team: 'npc', x: 2, y: 18 });
      G.spawn('EVAC', { uid: 'evac3', team: 'npc', x: 0, y: 14 });
      G.spawn('AURORA', { uid: 'leona', team: 'player', x: 7, y: 14, protagonist: true });
      G.spawn('TITAN', { uid: 'kai', team: 'player', x: 6, y: 17, protagonist: true });
      G.spawn('E04', { uid: 'bat', x: 26, y: 14, hp: 12000, evaBonus: 15, boss: true, ai: { only: 'player', prefer: 'AURORA' } });
      // 黑曜 4 → 10：上下兩翼繞去打船的 5 台（原本 2 台）＋正面 5 台
      G.spawn('E01', { x: 20, y: 3, ai: { hitsNpc: true } }); G.spawn('E01', { x: 23, y: 6, ai: { hitsNpc: true } }); G.spawn('E01', { x: 17, y: 2, ai: { hitsNpc: true } });
      G.spawn('E01', { x: 21, y: 25, ai: { hitsNpc: true } }); G.spawn('E01', { x: 24, y: 23, ai: { hitsNpc: true } });
      G.spawn('E01', { x: 17, y: 11 }); G.spawn('E01', { x: 17, y: 17 }); G.spawn('E01', { x: 18, y: 14 }); G.spawn('E01', { x: 23, y: 9 }); G.spawn('E01', { x: 23, y: 20 });
      // 赤炎 2 → 5、鐵甲犀牛 1 → 2（護在影蝠周圍）
      G.spawn('E02', { x: 19, y: 12 }); G.spawn('E02', { x: 19, y: 16 }); G.spawn('E02', { x: 24, y: 11 }); G.spawn('E02', { x: 24, y: 17 }); G.spawn('E02', { x: 22, y: 14 });
      G.spawn('E03', { x: 27, y: 10 }); G.spawn('E03', { x: 27, y: 18 });
    },
    pre: [
      { place: '昭明號艦橋。跳躍倒數開始。' },
      ['通信士 遙', '跳躍充能開始！5 分鐘！'],
      ['瑪格麗特', '避難船全部靠近本艦！跳躍範圍內的船，一艘都不能少！'],
      ['通信士 遙', '雷達反應！高速接近中……是影蝠！'],
      ['甲斐', '……那小子，真的來了。'],
      ['蕾歐娜', '甲斐，其他的交給你。影蝠……讓我來。'],
      ['甲斐', '蕾歐娜。'],
      ['蕾歐娜', '嗯？'],
      ['甲斐', '把他揍回來。'],
      ['蕾歐娜', '……嗯。'],
      { place: '影蝠駕駛艙。' },
      ['諾亞', '昭明號，停止跳躍。交出原初神鋼，我保證所有人的安全。'],
      ['瑪格麗特', '諾亞，這是你的意思，還是你老師的意思？'],
      ['諾亞', '……是我的意思。我不想讓你們跳到地球，那裡是聯邦的大本營！老姊，跟我走。我們這邊……至少不會說「殖民衛星再蓋就有」！'],
    ],
    hooks: {
      async playerPhaseStart(G) {
        const bat = G.unit('bat');
        if (bat) { bat.noCounter = false; bat.skipTurn = false; }
        if (G.turn === 1) await G.talk([
          ['諾亞', '老姊，我說過，下次見面要給我一個答案。'],
          ['蕾歐娜', '我會給你。但不是用嘴巴隔著通信說。'],
          ['諾亞', '……那就過來啊。'],
          { sys: '昭明號 5 回合後完成跳躍。昭明號或避難船被擊沉就會失敗。' },
        ]);
        if (G.turn === 3) {
          // v8：增援 3 → 7 台（黑曜 2→5 從右上、右下角，赤炎 1→2 從右側中央）
          for (const [x, y] of [[29, 0], [29, 29], [29, 4], [29, 25], [25, 0]]) G.spawn('E01', G.freeCell(x, y));
          G.spawn('E02', G.freeCell(29, 13)); G.spawn('E02', G.freeCell(29, 16)); G.render();
          await G.talk([
            ['席格', '諾亞，增援到了。跳躍還有兩分鐘，你必須做出決定。'],
            ['諾亞', '老師，再給我一點時間——'],
            ['席格', '時間，是你姊姊給你的。不是我。'],
          ]);
        }
        if (G.turn >= 2 && G.turn <= 5) G.log(`⏳ 跳躍倒數：剩 ${6 - G.turn} 回合`, 'player');
        if (G.turn === 6 && bat && !G.vars.finaleQueued) await batFinale(G, true);
      },
      interceptDeath(G, def) {
        if (def.uid !== 'bat') return false;
        if (!G.vars.finaleQueued) { G.vars.finaleQueued = true; G.later(() => batFinale(G, false)); }
        return true;
      },
      async onDamage(G, def, att) {
        if (def.uid === 'bat' && att && att.uid === 'kai' && G.once('kaiHitBat')) G.later(() => G.talk([
          ['甲斐', '諾亞！你明明說我們都是被丟下的弟弟！'],
          ['諾亞', '所以我才不想再被丟下了！甲斐，你哥哥也是自己走的，你不懂嗎！？'],
          ['甲斐', '我懂！所以我才要把你揍回來！'],
        ]));
        if (def.uid === 'bat' && def.hp <= def.maxHp * 0.5 && !G.vars.finaleQueued && G.once('batHalf')) {
          def.weapons.push(Object.assign({}, BOSS_BAT_WEAPON_UNLOCK, { left: -1 }));
          G.later(() => G.talk([
            ['諾亞', '我不會輸……我好不容易才有了翅膀……！'],
            { sys: '影蝠解禁「超音速音障轟炸」！' },
          ]));
        }
      },
    },
    talks: [
      // ◆ 隱藏條件一：蕾歐娜對影蝠說服（畫面上不提示成功與否）
      { from: 'leona', to: 'bat', when: (G) => !G.vars.finaleQueued, async run(G, me, bat) {
        if (!G.flags.NOAH_HEARD_SISTER) {
          G.flags.NOAH_HEARD_SISTER = true;
          await G.talk([
            ['蕾歐娜', '諾亞，你上次問我在保護什麼。'],
            ['諾亞', '……'],
            ['蕾歐娜', '我一直以為我在保護你。但其實，我只是害怕。我怕你飛得比我好，飛到我追不上的地方。'],
            ['諾亞', '……老姊？'],
            ['蕾歐娜', '雲雀的閃法，影蝠的閃法，我都看見了。你飛得比我好。我一直都知道。'],
            ['蕾歐娜', '我想保護的，是那些人，還有你。不是因為你需要被保護，是因為……你是我弟弟。'],
            { n: '（很長的沉默。）' },
            ['諾亞', '……太遲了啦，老姊。'],
            ['諾亞', '這種話……為什麼不早點說。'],
            { n: '（影蝠的動作停頓了。）' },
          ]);
          bat.noCounter = true; bat.skipTurn = true;
        } else {
          await G.talk([['蕾歐娜', '諾亞，跟我說話！'], ['諾亞', '……我在聽。我一直都在聽。']]);
        }
      } },
      { from: 'kai', to: 'bat', once: true, async run(G) {
        await G.talk([
          ['甲斐', '你老姊昨天在機庫坐了一整晚，你知道嗎？'],
          ['諾亞', '……別說了。'],
          ['甲斐', '她說是她把你推出去的。'],
          ['諾亞', '……那個笨蛋。'],
        ]);
      } },
    ],
    victory: (G) => !!G.vars.batDown,
    defeat: (G) => G.protagonistsDown() || G.units.some((u) => u.kind === 'ship' && u.hp <= 0),
    post: [
      { place: '跳躍空域。爆炸的光還沒散去。' },
      ['通信士 遙', '跳躍充能完成！'],
      ['瑪格麗特', '……蕾歐娜，回艦。'],
      { n: '（蕾歐娜沒有回應。）' },
      ['甲斐', '蕾歐娜！'],
      ['蕾歐娜', '……我的手。我用這雙手……'],
      ['甲斐', '先回來！要哭回來再哭！'],
      { n: '（轟天巨神抓住極光鋼姬的手臂，把她拖向昭明號。）' },
      ['瑪格麗特', '昭明號，跳躍！'],
      { n: '（昭明號與避難船消失在光芒中。）' },
      { place: '同一片空域，跳躍之後。只剩下影蝠的殘骸在漂。' },
      { n: '（白銀死神的剪影出現在遠方。）' },
      ['席格', '……我說過，不要死。'],
      { n: '（殘骸深處，一個極微弱的紫黑色光點亮起。）' },
      ['？？？', '……好深的遺憾。'],
      ['？？？', '這份因果，我收下了。'],
      { n: '（紫黑色光點吞沒影蝠殘骸，消失。）' },
      { place: '昭明號・跳躍後。蕾歐娜的艙房。' },
      { n: '（蕾歐娜打開冰箱。裡面有兩顆蛋，還有一張便條：「老姊，記得吃。——諾亞」）' },
      { n: '（她拿起蛋，站在爐子前，很久都沒有動。）' },
      ['蕾歐娜', '……我不會煎啊。笨蛋。'],
      { sys: '蕾歐娜・艾爾文 進入【低潮】狀態　全能力 -20%　（解除條件：？？？）' },
      { sys: '── 第一大關 完 ──' },
    ],
    onClear(G) { G.flags.LEONA_SLUMP = true; },
  },
];

// 1-3：影蝠撤退（第 5 回合，或血量降到三成以下）
async function batRetreat13(G) {
  if (G.vars.batGone || !G.unit('bat')) return;
  G.vars.batGone = true;
  await G.talk([
    ['席格', '諾亞，夠了。回來。'],
    ['諾亞', '……是，老師。'],
    ['蕾歐娜', '老師？你是誰！'],
    ['席格', '妳就是艾爾文吧。妳的弟弟有翅膀，妳卻一直把他關在籠子裡。我會好好教他飛。'],
    ['諾亞', '老姊。……煎蛋的話，冰箱裡還有兩顆。記得吃。'],
    { n: '（影蝠消失在殘骸帶深處。）' },
  ]);
  G.remove('bat');
}
