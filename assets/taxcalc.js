/* 세무법인 이움 중앙지점 간이 세금계산 엔진. 근거 조문은 2026-10-26 법제처 원문 확인분.
   세액은 원 미만 버림. 중과세·감면·세액공제(상속·증여 외)·세무조정은 반영하지 않는 참고용이다. */
(function (root) {
  const F = Math.floor;
  const M = 10000, E = 100000000;
  // 누진세율표: [구간 상한, 세율] (마지막 상한 Infinity)
  const T = {
    income: [[14e6, .06], [50e6, .15], [88e6, .24], [150e6, .35], [300e6, .38], [500e6, .40], [1e9, .42], [Infinity, .45]], // 소득세법 §55①
    corp: [[2e8, .10], [200e8, .20], [3000e8, .22], [Infinity, .25]],   // 법인세법 §55①1호
    gift: [[1e8, .10], [5e8, .20], [10e8, .30], [30e8, .40], [Infinity, .50]], // 상증세법 §26(§56 준용)
  };
  function prog(base, table) {
    let tax = 0, lo = 0;
    for (const [up, r] of table) {
      if (base <= lo) break;
      tax += (Math.min(base, up) - lo) * r; lo = up;
    }
    return F(tax);
  }
  const local = x => F(x * 0.1); // 지방세법 §92①·§103의3①·§103의20① 표준세율은 국세 세율의 10분의 1

  function years(a, b) { // a(취득)~b(양도) 사이의 만 연수. 문자열을 나눠 계산해 시간대 영향이 없다
    if (!a || !b) return 0;
    const [ay, am, ad] = a.split("-").map(Number), [by, bm, bd] = b.split("-").map(Number);
    let y = by - ay;
    const leap = x => (x % 4 === 0 && x % 100 !== 0) || x % 400 === 0;
    const annivDay = (am === 2 && ad === 29 && !leap(by)) ? 28 : ad;   // 해당일이 없으면 그 달 말일(민법 §160③)
    if (bm < am || (bm === am && bd < annivDay)) y--;
    return Math.max(0, y);
  }

  // 1) 종합소득세(사업소득 간이)
  function income({ revenue = 0, expense = 0, deduction = 1500000 }) {
    const profit = Math.max(0, revenue - expense);
    const base = Math.max(0, profit - deduction);
    const tax = prog(base, T.income), lt = local(tax);
    return { steps: [["사업소득금액(수입 - 필요경비)", profit], ["종합소득공제", -Math.min(profit, deduction)], ["과세표준", base], ["종합소득세 산출세액", tax], ["개인지방소득세(10%)", lt]], total: tax + lt, base };
  }
  // 2) 법인세(세무조정 전 간이)
  function corp({ revenue = 0, expense = 0 }) {
    const base = Math.max(0, revenue - expense);
    const tax = prog(base, T.corp), lt = local(tax);
    return { steps: [["각 사업연도 소득(수입 - 비용)", base], ["법인세 산출세액", tax], ["법인지방소득세(10%)", lt]], total: tax + lt, base };
  }
  // 3) 양도소득세(부동산)
  function transfer({ kind = "house", sale = 0, cost = 0, expense = 0, acq, sold, oneHouse = false, liveYears = 0 }) {
    const hold = years(acq, sold);
    liveYears = Math.min(liveYears, hold);                            // 시행령 §159의4: 보유기간 중 거주기간
    let gain = Math.max(0, sale - cost - expense);
    const steps = [["양도차익(양도가액 - 취득가액 - 필요경비)", gain], ["보유기간", hold + "년"]];
    if (kind === "house" && oneHouse && sale <= 12e8) {
      steps.push(["1세대 1주택 비과세(양도가액 12억원 이하)", "비과세"]);
      return { steps, total: 0, base: 0, exempt: true };
    }
    let ratio = 1;
    if (kind === "house" && oneHouse && sale > 12e8) { ratio = (sale - 12e8) / sale; } // 시행령 §160
    let rate = 0;
    if (hold >= 3) {
      if (kind === "house" && oneHouse && liveYears >= 2) {          // 표2 (시행령 §159의4: 거주 2년 이상)
        const h = Math.min(.40, .04 * hold);
        const l = liveYears >= 3 ? Math.min(.40, .04 * liveYears) : .08;
        rate = h + l;
      } else rate = Math.min(.30, .02 * hold);                     // 표1
    }
    const taxGain = F(gain * ratio);
    const ltd = F(gain * rate * ratio);
    if (ratio < 1) steps.push(["12억원 초과분 과세 양도차익", taxGain]);
    steps.push(["장기보유특별공제(" + Math.round(rate * 100) + "%)", -ltd]);
    const amount = Math.max(0, taxGain - ltd);
    const basic = Math.min(amount, 2500000);
    const base = amount - basic;
    steps.push(["양도소득 기본공제", -basic], ["과세표준", base]);
    let tax = prog(base, T.income), how = "기본세율";
    const short = hold < 1 ? (kind === "house" ? .70 : .50) : hold < 2 ? (kind === "house" ? .60 : .40) : 0;
    if (short) { const s = F(base * short); if (s > tax) { tax = s; how = "단기 " + Math.round(short * 100) + "%"; } }
    const lt = local(tax);
    steps.push(["양도소득세 산출세액(" + how + ")", tax], ["개인지방소득세(10%)", lt]);
    return { steps, total: tax + lt, base };
  }
  // 4) 상속세
  function inherit({ estate = 0, finance = 0, debt = 0, funeral = 0, columbarium = 0, priorGift = 0, priorGiftDeducted = 0, priorGiftTax = 0, spouse = true, children = 2, spouseShare = 0 }) {
    const fu = Math.min(1e7, Math.max(5e6, funeral)) + Math.min(5e6, Math.max(0, columbarium)); // 시행령 §9②
    const value = Math.max(0, estate - debt - fu + priorGift);       // 과세가액(§13·§14)
    const steps = [["장례비용(500만~1천만원 + 봉안시설 500만원 한도)", -fu], ["상속세 과세가액(재산 - 채무 - 장례비 + 10년 내 사전증여)", value]];
    const spouseAlone = spouse && children === 0;
    const personal = 2e8 + 5e7 * children;                            // 기초공제 §18 + 자녀공제 §20①1호
    let lump = spouseAlone ? 2e8 : Math.max(5e8, personal);          // §21①②
    steps.push([spouseAlone ? "기초공제(배우자 단독상속)" : (personal > 5e8 ? "기초공제 + 자녀공제" : "일괄공제"), -lump]);
    let sp = 0;
    if (spouse) {
      const D = 1.5 / (1.5 + children);
      const limit = Math.min(30e8, F((Math.max(0, estate - debt) + priorGift) * D));
      sp = Math.max(5e8, Math.min(spouseShare, limit));               // §19①④
      steps.push(["배우자 상속공제", -sp]);
    }
    const net = Math.max(0, finance);
    const fin = net <= 2e7 ? net : Math.min(2e8, Math.max(F(net * .2), 2e7)); // §22
    if (fin) steps.push(["금융재산 상속공제", -fin]);
    let ded = lump + sp + fin;
    const cap = Math.max(0, value - (value > 5e8 ? Math.max(0, priorGift - priorGiftDeducted) : 0)); // §24
    if (ded > cap) { steps.push(["공제 종합한도 적용(초과분 제외)", ded - cap]); ded = cap; }
    let base = Math.max(0, value - ded);
    if (base < 500000) base = 0;                                      // §25②
    steps.push(["과세표준", base]);
    const tax = prog(base, T.gift);
    const credit = Math.min(tax, priorGiftTax);
    const filing = F((tax - credit) * .03);                            // §69①
    steps.push(["상속세 산출세액", tax]);
    if (credit) steps.push(["증여세액공제(사전증여 때 낸 세금)", -credit]);
    steps.push(["신고세액공제(3%)", -filing]);
    return { steps, total: tax - credit - filing, base };
  }
  // 5) 증여세
  const LIMIT = { spouse: 6e8, parentAdult: 5e7, parentMinor: 2e7, child: 5e7, relative: 1e7, other: 0 }; // §53
  function gift({ amount = 0, relation = "parentAdult", prior = 0, priorTax = 0, marriage = false, marriageUsed = 0, skip = false, minor = false }) {
    // marriageUsed = 이번 합산(같은 증여자) 밖의 다른 증여에서 이미 받은 혼인·출산 공제. 합산분 안의 공제는 다시 계산된다
    const value = amount + prior;
    const steps = [["증여세 과세가액(이번 + 10년 내 같은 사람에게 받은 것)", value]];
    const ded = Math.min(value, LIMIT[relation] || 0);
    steps.push(["증여재산공제", -ded]);
    let mar = 0;
    if (marriage && (relation === "parentAdult" || relation === "parentMinor")) {
      mar = Math.min(Math.max(0, 1e8 - marriageUsed), value - ded); // §53의2
      steps.push(["혼인·출산 증여재산공제", -mar]);
    }
    let base = Math.max(0, value - ded - mar);
    if (base < 500000) base = 0;                                      // §55②
    steps.push(["과세표준", base]);
    const tax = prog(base, T.gift);
    let add = 0;
    if (skip && (relation === "parentAdult" || relation === "parentMinor")) {
      add = F(tax * (minor && value > 20e8 ? .40 : .30));               // §57, 시행령 §46의3①(합산분 포함)
      steps.push(["증여세 산출세액", tax], ["세대생략 할증(" + (minor && value > 20e8 ? "40" : "30") + "%)", add]);
    } else steps.push(["증여세 산출세액", tax]);
    const credit = Math.min(tax + add, priorTax);
    if (credit) steps.push(["기납부세액공제(이전에 낸 증여세)", -credit]);
    const filing = F((tax + add - credit) * .03);                      // §69②
    steps.push(["신고세액공제(3%)", -filing]);
    return { steps, total: tax + add - credit - filing, base };
  }

  // 6) 세후 급여(월). 근로소득세 = 소득세법 시행령 별표 2 간이세액표(withholding.js),
  //    4대보험 근로자 부담 = 요율표.json(rates.js). 원 미만·10원 미만 처리는 급여설계 스킬 calc_payroll_tax.py와 같다.
  const fix = x => Math.round(x * 1e4) / 1e4;                         // 소수점 오차 정리(2,800,000×0.0719가 201,319.999…로 나오는 것 방지)
  const f10 = x => Math.floor(fix(x) / 10) * 10, f1000 = x => Math.floor(fix(x) / 1000) * 1000;
  function wtax(taxable, family, kids, W) {
    const k = Math.floor(taxable / 1000);                              // 천원 단위 구간
    const col = v => {                                                 // 공제대상가족 수별 값(11명 초과는 별표 2 제4호)
      if (family <= 11) return v[Math.max(1, family) - 1];
      return Math.max(0, v[10] - (v[9] - v[10]) * (family - 11));
    };
    let t;
    if (k < 770) t = 0;
    else if (k < 10000) { const r = W.rows.find(r => r[0] <= k && k < r[1]); t = col(r[2]); }
    else {
      const b = col(W.at10000), x = taxable;
      if (x <= 10e6) t = b;
      else if (x <= 14e6) t = b + (x - 10e6) * .98 * .35 + 25000;
      else if (x <= 28e6) t = b + 1397000 + (x - 14e6) * .98 * .38;
      else if (x <= 30e6) t = b + 6610600 + (x - 28e6) * .98 * .40;
      else if (x <= 45e6) t = b + 7394600 + (x - 30e6) * .40;
      else if (x <= 87e6) t = b + 13394600 + (x - 45e6) * .42;
      else t = b + 31034600 + (x - 87e6) * .45;
    }
    const kd = kids <= 0 ? 0 : kids === 1 ? 20830 : kids === 2 ? 45830 : 45830 + 33330 * (kids - 2); // 별표 2 제3호
    return f10(Math.max(0, fix(t) - kd));
  }
  function salary({ pay = 0, nontax = 200000, family = 1, kids = 0 }, R, W) {
    const b = Math.max(0, pay - nontax);                               // 과세 급여 = 보수월액
    const np = f10(Math.min(f1000(b), R.npCap) * R.np / 2);
    const nhT = f10(b * R.nhis), nh = f10(nhT / 2);
    const ltT = f10(nhT * R.ltc), lt = f10(ltT / 2);
    const ei = f10(b * R.ei);
    const it = wtax(b, family, kids, W), lit = f10(it * .1);
    const ded = np + nh + lt + ei + it + lit;
    return { steps: [["세전 월급여", pay], ["비과세(식대 등)", nontax], ["과세 급여(보수월액)", b],
      ["국민연금(4.75%)", -np], ["건강보험(3.595%)", -nh], ["장기요양보험(건강보험료의 13.14%)", -lt], ["고용보험(0.9%)", -ei],
      ["근로소득세(간이세액표)", -it], ["지방소득세(10%)", -lit], ["공제 합계", -ded]], total: pay - ded, base: b };
  }
  const api = { prog, T, income, corp, transfer, inherit, gift, years, salary, wtax };
  if (typeof module !== "undefined") module.exports = api; else root.TaxCalc = api;
})(this);
