import { expandLemmaToSurfaceForms } from './lemma-expander';

describe('expandLemmaToSurfaceForms', () => {
  // 这个 expander 用于词族 surface-form 完整化（ADR 0018）。测试要求：
  // 1) 不规则变形通过反向 wink 表覆盖（women, went, broken, better）
  // 2) 规则变形通过正字法规则生成（cats, runs, running, stopped）
  // 3) 不漏关键 case——任何缺失会让 vocabularyMirror.byLemma 丢键，highlight 失效

  it('woman 展开包含 women', () => {
    const forms = expandLemmaToSurfaceForms('woman');
    expect(forms.has('woman')).toBe(true);
    expect(forms.has('women')).toBe(true);
  });

  it('go 展开包含全部不规则形态 went/gone/going/goes', () => {
    const forms = expandLemmaToSurfaceForms('go');
    expect(forms.has('go')).toBe(true);
    expect(forms.has('went')).toBe(true);
    expect(forms.has('gone')).toBe(true);
    expect(forms.has('going')).toBe(true);
    expect(forms.has('goes')).toBe(true);
  });

  it('break 展开包含 broke/broken/breaks/breaking', () => {
    const forms = expandLemmaToSurfaceForms('break');
    expect(forms.has('break')).toBe(true);
    expect(forms.has('broke')).toBe(true);
    expect(forms.has('broken')).toBe(true);
    expect(forms.has('breaks')).toBe(true);
    expect(forms.has('breaking')).toBe(true);
  });

  it('big 展开包含 bigger/biggest（CVC 双辅音）', () => {
    const forms = expandLemmaToSurfaceForms('big');
    expect(forms.has('big')).toBe(true);
    expect(forms.has('bigger')).toBe(true);
    expect(forms.has('biggest')).toBe(true);
  });

  it('good 展开包含不规则比较级 better/best', () => {
    const forms = expandLemmaToSurfaceForms('good');
    expect(forms.has('good')).toBe(true);
    expect(forms.has('better')).toBe(true);
    expect(forms.has('best')).toBe(true);
  });

  it('city 展开包含 cities（-y → -ies）', () => {
    const forms = expandLemmaToSurfaceForms('city');
    expect(forms.has('city')).toBe(true);
    expect(forms.has('cities')).toBe(true);
  });

  it('study 展开包含 studied/studies/studying', () => {
    const forms = expandLemmaToSurfaceForms('study');
    expect(forms.has('study')).toBe(true);
    expect(forms.has('studies')).toBe(true);
    expect(forms.has('studied')).toBe(true);
    expect(forms.has('studying')).toBe(true);
  });

  it('stop 展开包含 stopped/stopping（CVC 双辅音）', () => {
    const forms = expandLemmaToSurfaceForms('stop');
    expect(forms.has('stop')).toBe(true);
    expect(forms.has('stopped')).toBe(true);
    expect(forms.has('stopping')).toBe(true);
    expect(forms.has('stops')).toBe(true);
  });

  it('rate 展开 -e 删除（rated/rating）', () => {
    const forms = expandLemmaToSurfaceForms('rate');
    expect(forms.has('rate')).toBe(true);
    expect(forms.has('rated')).toBe(true);
    expect(forms.has('rating')).toBe(true);
    expect(forms.has('rates')).toBe(true);
  });

  it('box 展开包含 boxes（-es 复数）', () => {
    const forms = expandLemmaToSurfaceForms('box');
    expect(forms.has('box')).toBe(true);
    expect(forms.has('boxes')).toBe(true);
  });

  it('lie 展开包含 lay/lain/lying（不规则 + -ie 删除）', () => {
    const forms = expandLemmaToSurfaceForms('lie');
    expect(forms.has('lie')).toBe(true);
    expect(forms.has('lay')).toBe(true);
    expect(forms.has('lying')).toBe(true);
  });

  it('mouse 展开包含 mice', () => {
    const forms = expandLemmaToSurfaceForms('mouse');
    expect(forms.has('mouse')).toBe(true);
    expect(forms.has('mice')).toBe(true);
  });

  it('大小写无关 / 输入空串安全', () => {
    expect(expandLemmaToSurfaceForms('WOMAN').has('women')).toBe(true);
    expect(expandLemmaToSurfaceForms('').size).toBe(0);
    expect(expandLemmaToSurfaceForms('   ').size).toBe(0);
  });
});
