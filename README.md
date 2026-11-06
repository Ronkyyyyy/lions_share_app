# 近似値の金獅子 問題表示アプリ（MVP）

静的サイトです。フォルダごと HTTPS のサーバーに置けば動きます（PWA・Wake Lock は HTTPS 必須）。

## 手元で確認する

```
cd app
python3 -m http.server 8765
```

ブラウザで http://localhost:8765 を開く。

## ファイル構成

| パス | 内容 |
| --- | --- |
| index.html | 画面一式と獅子アイコン（線画SVG）のテンプレート |
| css/app.css | 配色（CSS変数）・レイアウト・演出 |
| js/app.js | セット配分、檻の開示、カウントアップ、Wake Lock |
| data/questions.json | 問題データ（差し替えるだけで更新できる） |
| sw.js | オフライン用キャッシュ |
| fonts/ | Zen Antique（サブセット）・Bodoni Moda の WOFF2 |
| img/ | 獅子イラスト（金・銀・銅・黒）とホーム画面アイコン |
| tools/build-fonts.sh | 問題の文字に合わせて日本語フォントを作り直す |

## 問題データ

`rounds` が各ラウンドの枠です。`types` には「全セット合計でその枠に入れる型ごとの問題数」を書き、型ごとの合計を問題の内訳と一致させてください。各枠の合計がセット数になります。
`version` を変えると、各端末で次回起動時にセットが組み直されます。

新しい漢字を含む問題を足したら `tools/build-fonts.sh` でフォントを作り直してください（入っていない字は端末の明朝体で表示されます）。

## 設定

- ルールブックの URL：`js/app.js` の `RULEBOOK_URL`（空のあいだは「準備中」と表示）
- アプリ本体を更新したら `sw.js` の `CACHE_VERSION` を上げる

## Numbers の問題シートから取り込む

```
python3 -m pip install numbers-parser
python3 tools/import_numbers.py <kinjishi_quiz_YYYYMMDD.numbers>
```

「問題カード」シートを読み、`questions` を置き換えます（`rounds` はそのまま）。シートに単位の列がないため、単位は `tools/import_numbers.py` の `UNITS` で持っています（シートに「単位」列を足せばそちらが優先）。「推理のヒント」は正解確定後に表示し、「注意点」は `memo` として保存するだけで表示しません。
