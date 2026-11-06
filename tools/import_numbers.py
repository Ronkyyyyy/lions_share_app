# Numbers の問題シート（問題カード）を data/questions.json に変換する
#   python3 tools/import_numbers.py <kinjishi_quiz.numbers>
# 必要なもの: python3 -m pip install numbers-parser
import json, os, sys, warnings
warnings.filterwarnings('ignore')
from numbers_parser import Document

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'questions.json')

# シートに単位の列がないため、問題IDごとの単位をここで持つ（シートに「単位」列ができたらそちらを優先）
UNITS = {
    'Q01': '条', 'Q02': '回', 'Q03': '日', 'Q04': '日', 'Q05': 'か所', 'Q06': 'm', 'Q07': 'か国',
    'Q08': '個', 'Q09': '', 'Q10': '円', 'Q11': 'cm', 'Q12': '種目', 'Q13': '編', 'Q14': 'm',
    'Q15': '字', 'Q16': 'm', 'Q17': 'km/h', 'Q18': '日', 'Q19': 'mm²', 'Q20': '回', 'Q21': '秒',
    'Q22': '種類', 'Q23': 'か所', 'Q24': '海里', 'Q25': '本', 'Q26': '字', 'Q27': 'kJ', 'Q28': 'km',
    'Q29': 'kg', 'Q30': '手', 'Q31': 'mm', 'Q32': '話', 'Q33': '枚', 'Q34': '本', 'Q35': 'm',
    'Q36': '', 'Q37': 'cm', 'Q38': '番', 'Q39': '音', 'Q40': '円', 'Q41': 'm', 'Q42': '島',
    'Q43': '路線', 'Q44': '', 'Q45': 'm', 'Q46': '回', 'Q47': 'mL', 'Q48': '日', 'Q49': '個',
    'Q50': 'm',
}

# 「注意点」にある解答前に必要な条件を、問題文に移した版（ID: (シートの問題文, 置き換える問題文)）。
# シートの問題文が左と同じときだけ置き換える。シート側を直したら、その行は消してよい
QUESTION_FIXES = {
    'Q04': ('元号が「平成」だった期間は何日間？',
            '元号が「平成」だった期間は何日間？（最初の日と最後の日も含む）'),
    'Q18': ('1964年東京オリンピックの開会式から、東京2020オリンピックの開会式まで、何日後？',
            '1964年東京オリンピックの開会式から、東京2020オリンピックの開会式まで、何日後？（1964年の開会式の日を0日目とする）'),
    'Q30': ('大相撲で、2001年1月場所から日本相撲協会が定めている決まり手は全部で何手？',
            '大相撲で、2001年1月場所から日本相撲協会が定めている決まり手は全部で何手？（勇み足などの「非技」は含まない）'),
    'Q32': ('漫画『こちら葛飾区亀有公園前派出所』が連載終了するまでの話数は？',
            '漫画『こちら葛飾区亀有公園前派出所』が連載終了するまでの話数は？（外伝・スピンオフは含まない）'),
}


def main(path):
    doc = Document(path)
    sheet = next(s for s in doc.sheets if s.name == '問題カード')
    rows = sheet.tables[0].rows(values_only=True)
    head = rows[0]
    col = {name: i for i, name in enumerate(head)}
    old = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    questions, problems, fixed = [], [], []
    for r in rows[1:]:
        qid = r[col['ID']]
        if not qid or r[col['正解']] is None:
            continue
        ans = r[col['正解']]
        if ans != int(ans) or ans <= 0:
            problems.append(f'{qid}: 正解が自然数ではありません（{ans}）')
        unit = r[col['単位']] if '単位' in col and r[col['単位']] is not None else UNITS.get(qid)
        if unit is None:
            problems.append(f'{qid}: 単位がありません')
            unit = ''
        text = str(r[col['問題文']]).strip()
        if qid in QUESTION_FIXES and QUESTION_FIXES[qid][0] == text:
            text = QUESTION_FIXES[qid][1]
            fixed.append(qid)
        q = {
            'id': 'A00-%03d' % int(qid.lstrip('Q')),
            'question': text,
            'answer': int(ans),
            'unit': unit,
            'type': r[col['型']],
            'pack': '基本',
        }
        hint = r[col['推理のヒント']]
        if hint:
            q['note'] = str(hint).strip()
        if '基準日' in col and r[col['基準日']]:
            q['asOf'] = str(r[col['基準日']])
        if r[col['注意点']]:
            q['memo'] = str(r[col['注意点']]).strip()  # 進行役向けのメモ。アプリには表示しない
        questions.append(q)
    data = {
        'version': 'A00-' + os.path.splitext(os.path.basename(path))[0].split('_')[-1],
        'pack': 'A00',
        'rounds': old.get('rounds', []),
        'questions': questions,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'{len(questions)} 問を書き出しました → {os.path.relpath(OUT)}')
    if fixed:
        print('  問題文に条件を補った:', ', '.join(fixed))
    for p in problems:
        print('  !', p)

if __name__ == '__main__':
    main(sys.argv[1])
