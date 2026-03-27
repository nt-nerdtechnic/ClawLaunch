# Pixel Office — 開發目標文件

> 最後更新：2026-03-27
> 模組位置：`frontend/src/components/pixel-office/`

---

## 一、現況描述

### 已完成功能

| 模組 | 狀態 | 說明 |
|------|------|------|
| `engine/types.ts` | ✅ 完成 | PixelAgent, RoomConfig, DeskSlot 等型別 |
| `engine/constants.ts` | ✅ 完成 | Tile 大小、畫布解析度、顏色配置 |
| `engine/sprites.ts` | ⚠️ 需升級 | 12×16 像素角色 + 基礎家具，視覺品質不足 |
| `engine/spriteCache.ts` | ✅ 完成 | offscreen canvas 預渲染快取 |
| `engine/room.ts` | ⚠️ 需升級 | 30×20 主大廳，佈局過於稀疏、缺乏細節 |
| `engine/pathfinding.ts` | ✅ 完成 | A* 尋路（上限 500 節點）|
| `engine/agent.ts` | ✅ 完成 | idle / walking / working 狀態機 |
| `engine/renderer.ts` | ⚠️ 需升級 | Canvas 2D 渲染，缺光影/輪廓/深度感 |
| `engine/tooltip.ts` | ✅ 完成 | 滑鼠 Hit-test |
| `hooks/usePixelOfficeAgents.ts` | ✅ 完成 | Zustand snapshot → PixelAgent 資料流 |
| `hooks/usePixelOfficeLoop.ts` | ⚠️ 效能問題 | rAF loop，但 dep 陣列包含 hoveredAgentId |
| `PixelOfficeCanvas.tsx` | ✅ 完成 | canvas 元件 + tooltip overlay |
| `PixelOfficeWidget.tsx` | ✅ 完成 | 浮動按鈕（Building2 icon）+ 面板殼 |
| App.tsx 整合 | ✅ 完成 | mini + expanded 兩處均已加入 |
| i18n（zh-TW / zh-CN / en）| ✅ 完成 | `pixelOffice.*` 命名空間 |

---

## 二、已知問題清單

### 🎨 P0 — 視覺品質（最優先改善）

#### 2.1 角色 Sprite 品質差
- **根本原因**：Sprite 尺寸僅 12×16，且無深色輪廓邊框
- **問題細節**：
  - pixel-claw 的角色每個像素邊緣有 1px 深色 outline，呈現「剪影清晰感」
  - 目前所有角色服裝使用同一個 `darken()` 公式，導致深色 agent 顏色變成泥巴色
  - 坐姿（type）sprite 沒有顯示椅子，視覺上像浮在空中打字
  - 頭髮僅用 `darken(baseColor, 30)` 計算，沒有亮面/暗面層次
  - 眼睛太小（1px），幾乎看不見
  - 無臉部表情差異

**目標**：升級至 16×24 sprite，加入 1px 深色輪廓、明暗分層、多樣頭髮樣式

#### 2.2 家具缺乏細節
- 桌子上**沒有顯示器/筆電**，是一個 AI agent 辦公室但看不到任何電腦
- 椅子與桌子視覺比例不對（椅子寬度幾乎和桌子一樣）
- 沒有桌面物品（滑鼠、馬克杯、文件堆）
- Server rack LED 燈太小（1px）、閃爍效果未實作於 Canvas 中

**目標**：每張桌子加一台顯示器，顯示器在 working 狀態時有螢幕發光效果

#### 2.3 地板與牆壁無深度感
- 地板僅為棋盤色塊，缺乏木紋或磁磚線條感
- 北牆（頂部）太薄（2 tiles），沒有窗戶裝飾
- 無牆壁陰影投射到地板
- 無燈光/光暈效果

**目標**：地板加磁磚縫線；北牆加窗框（帶光線條）；家具加底部陰影

#### 2.4 渲染器缺乏光影

```
現在：純色填充 fillRect，所有物件亮度相等
目標：北牆投影陰影帶、家具正面 vs 頂面顏色差異、working agent 桌上有螢幕光暈
```

---

### 🐛 P1 — 功能性 Bug

#### 2.5 遊戲循環效能問題
**位置**：`hooks/usePixelOfficeLoop.ts`

```typescript
// 問題：hoveredAgentId 和 dark 在 useCallback deps 中
// 每次 hover 都會重建 loop callback，導致 rAF 重啟
const loop = useCallback((time: number) => { ... }, [
  canvasRef, agentsRef, room, cache, hoveredAgentId, dark  // ← 問題在這兩個
]);
```

**修正方向**：改用 `useRef` 存放 `hoveredAgentId` 和 `dark`，loop 讀 ref 即可，不需要在 deps 中

#### 2.6 Agent 顯示名稱直接用 agentId
**位置**：`hooks/usePixelOfficeAgents.ts:109`

```typescript
displayName: agentId,  // 顯示 "main" "worker" 等系統 ID
```

**修正方向**：嘗試從 `sessions[0]` 取出更友善的名稱，或將 agentId 做首字大寫格式化

#### 2.7 空辦公室沒有展示畫面
當 gateway 未啟動 / 沒有任何 agent session，畫面顯示文字「No active agents」但 canvas 仍是空白辦公室

**修正方向**：沒有 agent 時顯示 demo 模式——2-3 個 NPC 在辦公室隨機走動

#### 2.8 Panel 在 compact 模式尺寸錯誤
`PixelOfficeWidget.tsx` 在 compact 模式下 panel 為 `340x280`，但 canvas 解析度為 `480x320`，aspect ratio 為 1.5，寬高比不一致會讓像素變形

**修正方向**：用 `340 / (480/320) = 227px` 計算正確高度，或改讓 canvas 以 CSS `object-fit: contain` 自動填充

#### 2.9 Agent 站起離桌動作突兀
**位置**：`engine/agent.ts:195`

```typescript
agent.y += TILE_SIZE;  // 直接跳位，無平滑過渡
```

---

### ⚙️ P2 — 技術債

#### 2.10 缺乏 Demo / Mock 模式
開啟介面時需要實際連線到 gateway 才能看到任何 agent，無法在開發時預覽效果

#### 2.11 Sprite 模板顏色系統太簡陋
目前 `agentThemeFromColor()` 只由一個 base color `darken()` 計算出所有服裝顏色，導致：
- 深色 base color (如 `#34495e`) → 褲子變全黑，鞋子也全黑，無對比
- 淺色 base color (如 `#ecf0f1`) → 整個角色太白、消失在地板上

**修正方向**：預定義 8 組配色方案（包含亮面色、暗面色），而非動態計算

#### 2.12 缺乏 Canvas resize 響應
目前 Canvas 解析度固定 480×320，CSS 用 `w-full h-full` 縮放，在 compact/normal 兩種面板大小中**像素大小不同**，pixel art 在較小面板中看起來較清晰但在較大面板中會糊

---

## 三、改善目標清單

### 🎯 Phase A — 視覺大翻新（核心目標）

**A1. 升級角色 Sprite（16×24）**

```
規格：
- 尺寸：16w × 24h（提升 33% 解析度）
- 輪廓：每個 sprite 加 1px 深色邊框（顏色：darken 50%）
- 頭髮：3 像素高，有亮面（頂部 1px 加白）
- 眼睛：2×2 pixel，左右各一，有瞳孔點
- 衣領：1px 白領細節
- 坐姿：顯示椅背，下半身被桌子遮擋（正確 Z-order）
- 動畫幀數不變（idle×2, walk×4, type×2）
```

**A2. 新增 Monitor 家具（16×12）**

每張桌子正上方放一台顯示器：
- Idle 狀態：螢幕暗色（待機）
- Working 狀態：螢幕亮藍色 + 周圍加 ctx.shadowBlur 光暈效果
- 螢幕上顯示幾條掃描線（4px 等距深色橫線）

**A3. 增強地板渲染**

```typescript
// 目前：單純 fillRect 棋盤
// 目標：
// 1. 磁磚底色（2色棋盤）
// 2. 每個磁磚加 1px 深色縫線（底部 + 右側）
// 3. 縫線顏色：floor1 的 darken 20%
```

**A4. 北牆加窗框裝飾**

在 y=0、y=1 的牆磚區域，每隔 6 tiles 畫一扇「窗戶」：
- 窗框：2px 深色邊框
- 玻璃：半透明淡藍色 fillRect
- 光線：從窗戶往下延伸漸層（ctx.createLinearGradient）

**A5. 家具陰影**

每個家具底部畫一個橢圓形投影：
```typescript
ctx.fillStyle = 'rgba(0,0,0,0.12)';
ctx.beginPath();
ctx.ellipse(centerX, bottomY + 2, halfW, 3, 0, 0, Math.PI * 2);
ctx.fill();
```

**A6. 預定義 8 套角色配色方案**

取代動態 `darken()` 計算：

```typescript
const AGENT_THEMES: AgentTheme[] = [
  { hair: '#2c3e50', shirt: '#3498db', shirtLight: '#5dade2', pants: '#1a5276', shoes: '#1c2833' },
  { hair: '#7b241c', shirt: '#e74c3c', shirtLight: '#f1948a', pants: '#922b21', shoes: '#1c2833' },
  { hair: '#1e8449', shirt: '#2ecc71', shirtLight: '#82e0aa', pants: '#196f3d', shoes: '#1c2833' },
  // ... 共 8 套
];
```

---

### 🎯 Phase B — 功能完善

**B1. 修正 Loop 效能問題（P1 #2.5）**

```typescript
// 改用 ref 避免 loop 重建
const hoveredRef = useRef(hoveredAgentId);
const darkRef = useRef(dark);
useEffect(() => { hoveredRef.current = hoveredAgentId; }, [hoveredAgentId]);
useEffect(() => { darkRef.current = dark; }, [dark]);
```

**B2. Agent 顯示名稱格式化（P1 #2.6）**

```typescript
// agentId "main" → "Main"
// agentId "worker-1" → "Worker 1"
// agentId "telegram-bot" → "Bot"
function formatAgentName(agentId: string): string { ... }
```

**B3. Demo NPC 模式（P1 #2.7）**

當 `summaries.length === 0` 時，建立 3 個 NPC：
- NPC 不從 snapshot 讀取，只有 `idle` 和 `walking` 狀態
- 名稱顯示：「Idle」「Ready」「Standby」
- 橘/灰/藍配色

**B4. 離桌平滑動畫（P1 #2.9）**

```typescript
// 現在：agent.y += TILE_SIZE（瞬移）
// 改為：設定目標離桌 tile，走路離開
function standUpFromDesk(agent: PixelAgent, room: RoomConfig): void {
  const walkTile = { x: slot.seatTile.x, y: slot.seatTile.y + 2 };
  const path = findPath(pixelToTile(...), walkTile, ...);
  agent.path = path;
  agent.state = 'walking';
}
```

---

### 🎯 Phase C — 進階功能（未來）

**C1. 角色點擊事件**
- 點擊 agent → 展開詳細 side panel（聊天記錄、token 用量圖表）
- 與現有 ChatWidget 連動：點擊 agent → 切換聊天對象

**C2. 事件動畫**
- Agent 收到新訊息 → 頭頂出現驚嘆號泡泡（!）
- Agent 完成任務 → 拋出五彩紙屑 particle effect
- Agent 需要 approval → 頭頂出現問號泡泡（?）+ 紅色閃爍框

**C3. 房間擴充**
- 會議室（右側）：圓形大桌，多個 agent 圍坐
- 休息區（左側）：沙發、咖啡機
- 路由：agent 可以「走去」不同房間

**C4. 天氣 / 時間系統**
- 依據實際時間（早/午/晚）切換辦公室燈光模式
- 深夜：大部分燈關掉，只有螢幕亮著

---

## 四、優先順序矩陣

| 項目 | 影響力 | 工作量 | 優先級 |
|------|--------|--------|--------|
| A1 升級角色 Sprite（16×24 + 輪廓）| ★★★★★ | Medium | **P0** |
| A2 顯示器家具 + 螢幕光暈 | ★★★★☆ | Small | **P0** |
| A6 預定義配色方案 | ★★★★☆ | Small | **P0** |
| A3 地板縫線 | ★★★☆☆ | Small | **P1** |
| A4 北牆窗框 | ★★★☆☆ | Small | **P1** |
| A5 家具陰影 | ★★★☆☆ | Small | **P1** |
| B1 Loop 效能修正 | ★★☆☆☆ | Small | **P1** |
| B2 顯示名稱格式化 | ★★★☆☆ | Tiny | **P1** |
| B3 Demo NPC 模式 | ★★★★☆ | Medium | **P2** |
| B4 離桌平滑動畫 | ★★☆☆☆ | Small | **P2** |
| C1 點擊展開詳情 | ★★★★☆ | Large | **P3** |
| C2 事件動畫 | ★★★★★ | Large | **P3** |
| C3 多房間 | ★★★☆☆ | XLarge | **P4** |
| C4 時間系統 | ★★☆☆☆ | Medium | **P4** |

---

## 五、技術規格補充

### Canvas 解析度策略

```
面板模式      CSS 寬×高       Canvas解析度    Pixel scale
─────────────────────────────────────────────────────
compact       340 × 226       480 × 320       1.41x
normal        480 × 320       480 × 320       1.0x（1:1）
```

建議：`compact` 模式固定 canvas 480×320，CSS 用 `object-fit: contain` 縮放，保持 pixel-perfect。

### Sprite 尺寸對比

```
              目前            目標
角色尺寸      12 × 16         16 × 24
畫面繪製尺寸  24 × 32（scale×2） 32 × 48（scale×2）
佔畫布比例    5% / 10%        6.7% / 15%
可容納數量    約 12 個         約 8 個（但更清晰）
```

### 渲染層級（最終目標）

```
Layer 0: 地板磁磚（棋盤 + 縫線）
Layer 1: 北牆窗框光線（半透明漸層）
Layer 2: 東/西/南牆磚
Layer 3: 家具陰影（橢圓形投影）
Layer 4: 後景家具（Y < 視線中心）
Layer 5: Agent（Z-sort by Y）
Layer 6: 前景家具（Y > 視線中心）
Layer 7: 顯示器螢幕光暈（ctx.shadowBlur, only when working）
Layer 8: Agent 名牌
Layer 9: 狀態泡泡（! ? ✓）
Layer 10: Particle effects
```

---

## 六、參考資源

- **pixel-claw** sprite 風格：12-16px 角色，每個 pixel 有明確輪廓邊框，服裝有明暗兩色
- **現有快取機制**：`spriteCache.ts` 已支援任意 key，只需在 `buildSpriteCache()` 增加新 sprite
- **Canvas shadow API**：`ctx.shadowColor`, `ctx.shadowBlur`, `ctx.shadowOffsetX/Y`
  - 注意：shadowBlur 是全域設定，繪製後必須 reset to `''`/`0`
- **Pixel font**：考慮使用 [press-start-2p](https://fonts.google.com/specimen/Press+Start+2P) 做名牌字型，或直接 `ctx.font = 'bold 8px monospace'`

---

*此文件由開發工具自動生成，應在每次重大迭代後手動更新。*
