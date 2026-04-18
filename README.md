# fixi

ARG（Alternate Reality Game）・謎解き企画向け 疑似SNS基盤

Twitter 等の既存 SNS に依存せず、企画単位で完結・恒久稼働する「疑似 SNS」を静的ファイルのみで構築できます。

このリポジトリに同梱されている画像・動画はすべて宮乃やみが撮影したものなので権利関係を気にせずご利用いただけます。

---

## 設計思想：なぜ「完全な秘匿」を目指さないのか

fixi は SNS 調査パートにおけるシステム的なハックを**厳格に防ぐことを目的としていません**。

ゲーム性を毀損したいプレイヤーは、SNS を解析するより先に答えのネタバレを直接探すほうがはるかに手早いためです。そのような意図を持つプレイヤーに対して SNS 調査だけを難しくしても、謎解き体験の保護にはなりません。

fixi が防ぎたいのは「SNS 調査パートで少し頑張れば JSON を直読みして楽ができてしまう」という**意図せぬ近道**です。完全な秘匿ではなく、**ちょっと覗いただけでは答えが分からない程度の障壁**を設けることで、正規のゲーム体験を守ります。

---

## 利用方法：2つのルート

### ルート A ― 簡易利用（プログラミング知識不要）

SNS 調査パートでシステム的なハックが容易に行われても問題ない場合に適しています。
ターミナルは一切不要で、ブラウザと GitHub だけで完結します。

**手順**

1. このリポジトリを **Fork**
2. `config.json` を編集（サイト名・テーマ・基準日）
3. `admin.html` をブラウザで開き、ユーザーと投稿を作成 → `user.json` をダウンロード
4. `data/{userID}/` フォルダを作成し、`user.json` を配置
5. `data/index.json` に userID を追記
6. リポジトリの **GitHub Pages** を有効化
7. 公開 URL: `https://{username}.github.io/{repo-name}/`

> `data/` 以下の JSON はそのまま公開されます。サイトの URL が分かれば投稿内容を直接参照できます。

---

### ルート B ― 難読化ビルド（`node` コマンドが使える環境が必要）

SNS 調査パートで安易なハックを防ぎたい場合に適しています。
ビルドスクリプトが投稿本文・プロフィールを暗号化した成果物を生成します。
`sample/`・`admin.html`・`generator/` も成果物に含まれないため、ソースを覗かれても情報が漏れにくくなります。

**前提**
- Node.js がインストールされていること
- このリポジトリは **プライベート** にしておくことを推奨

**手順**

1. このリポジトリを clone（またはプライベートで Fork）
2. `config.json` を編集（`siteName` が暗号化の鍵になります）
3. `admin.html` をローカルサーバーで開いてデータを作成

   ```bash
   npx serve .
   # → http://localhost:3000/admin.html
   ```

4. データが揃ったらビルドを実行

   ```bash
   node build.js
   # → dist/ に暗号化済み成果物が生成されます
   ```

5. `dist/` の内容を **別の（パブリック）リポジトリ** に push
6. そのリポジトリの GitHub Pages を有効化

> `dist/` に含まれる `user.json` の投稿本文・プロフィールは暗号化されています。
> 鍵は `siteName` から導出されるため、サイト名を知らなければ平文に復元できません。
> ただし viewer の JS を読めば復号ロジックは分かるため、完全な秘匿ではありません。

---

## config.json

```json
{
  "siteName": "nisetter",
  "theme": "dark",
  "baseDate": "fixed:2026-05-01"
}
```

| キー | 値 |
|------|----|
| `siteName` | サイト名（ヘッダー・タイトルに表示。ルートBでは暗号化の鍵としても使用） |
| `theme` | `"dark"` または `"light"` |
| `baseDate` | `"fixed:YYYY-MM-DD"`（固定日基準）または `"relative"`（閲覧日基準） |

`baseDate` はすべての投稿の「現在時刻」基準点です。ARG 世界軸の「今日」を設定します。

---

## admin.html の使い方

ブラウザで開くだけで使える GUI 管理ツールです。ローカルサーバー経由で開いてください。

```bash
npx serve .
# → http://localhost:3000/admin.html
```

| 機能 | 説明 |
|------|------|
| user.json 生成 | ユーザー情報・投稿を入力して `user.json` をダウンロード |
| 既存データ読み込み | userID を入力して「データを読み込む」で既存の `user.json` を編集 |
| config.json 生成 | サイト設定を GUI で編集して `config.json` をダウンロード |

---

## ディレクトリ構成

```
/
├─ index.html          # viewer エントリ
├─ config.json         # サイト設定
├─ admin.html          # GUI 管理ツール（成果物には含まれない）
├─ build.js            # 難読化ビルドスクリプト（ルートB）
├─ viewer/             # SNS 風 UI（参照専用）
│   ├─ viewer.js
│   └─ style.css
├─ data/               # ユーザー・投稿データ
│   ├─ index.json      # userID 一覧
│   └─ {userID}/
│       ├─ user.json
│       ├─ icon.png    # アイコン画像（任意）
│       └─ ...         # 投稿に添付する画像・動画
├─ sample/             # ダミーデータ素材（成果物には含まれない）
│   ├─ patterns/       # 投稿テンプレート
│   ├─ icons/          # アイコン候補画像
│   ├─ photos/         # 投稿用写真候補
│   └─ videos/         # 投稿用動画候補
└─ generator/          # ダミーデータ一括生成スクリプト（任意・成果物には含まれない）
    └─ scripts.js
```

---

## データ構造

- ユーザー数：最大 200
- 投稿数：1 ユーザーあたり最大 200 件（合計最大 40,000 件）
- 投稿日時は `baseDate` からの相対秒数（`offset`）で管理
- フォロー/フォロワー関係の整合性は厳密に求めない（存在しないユーザーは「削除済み」表示にフォールバック）
- アイコン画像は `data/{userID}/icon.png` に配置（なければ名前の頭文字を表示）
- 画像・動画は `data/{userID}/` 配下に配置し、投稿の `media` フィールドにファイル名を指定

---

## viewer 機能

- タイムライン（無限スクロール）
- ユーザープロフィール
- 投稿スレッド（返信関係）
- 検索（ユーザー名・投稿全文）
- 画像・動画インライン表示

---

## generator（ダミーデータ一括生成）

多数のダミーユーザー・投稿を一括生成したい場合に使います。

```bash
# ユーザー作成
node generator/scripts.js create-user \
  --key alice --name "アリス" \
  [--bio "プロフィール文"]

# 投稿追加
node generator/scripts.js add-posts \
  --key alice --count 50 \
  [--category daily|rumor|reaction|cryptic] \
  [--reply-rate 0.2]
```

---

## 技術スタック

| 領域 | 採用 |
|------|------|
| フロントエンド | HTML + Vanilla JS |
| CSS | 素の CSS + media query + CSS 変数 |
| ビルド | 不要（ルートA）／Node.js（ルートB） |
| 配信 | GitHub Pages |
| フレームワーク | **使用しない** |
