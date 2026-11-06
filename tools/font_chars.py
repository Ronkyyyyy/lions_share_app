# 常用漢字（JIS第1水準＋2010年追加字）・かな・記号に、引数のファイルで使われている文字を加えて出力する
import sys
out=set()
# JIS X 0208 level-1 kanji (row 16-47) via EUC-JP
for row in range(16,48):
    for cell in range(1,95):
        try: out.add(bytes([0xA0+row,0xA0+cell]).decode('euc_jp'))
        except: pass
add2010="挨曖宛嵐畏萎椅彙茨咽淫唄鬱怨媛艶旺岡臆俺苛牙瓦楷潰諧崖蓋骸柿顎葛釜鎌韓玩伎亀毀畿臼嗅巾僅錦惧串窟熊詣憬稽隙桁拳鍵舷股虎錮勾梗喉乞傲駒頃痕沙挫采塞埼柵刹拶斬恣摯餌鹿𠮟叱嫉腫呪袖羞蹴憧拭尻芯腎須裾凄醒脊戚煎羨腺詮箋膳狙遡曽爽痩踪捉遜汰唾堆戴誰旦綻緻酎貼嘲捗椎爪鶴諦溺塡填妬賭藤瞳栃頓貪丼那奈梨謎鍋匂虹捻罵剝剥箸氾汎阪斑眉膝肘訃阜蔽餅璧蔑哺蜂貌頰頬睦勃昧枕蜜冥麺冶弥闇喩湧妖瘍沃拉辣藍璃慄侶瞭瑠呂賂弄籠麓脇"
out|=set(add2010)
for c in range(0x3040,0x3100): out.add(chr(c))      # hiragana/katakana
for c in range(0x3000,0x3040): out.add(chr(c))      # CJK punct
for c in range(0x20,0x7f): out.add(chr(c))
for c in range(0xFF01,0xFF5F): out.add(chr(c))      # fullwidth
out|=set("ー・〜←↑→↓…‥「」『』（）【】〈〉《》％＋－×÷＝○◯●△□■◆◇★☆※々〆")
for p in sys.argv[1:]:
    out|=set(open(p,encoding='utf-8').read())
print(''.join(sorted(c for c in out if c.strip())))
