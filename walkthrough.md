# Phoenix-X Paid Tournament Automation

The Paid Tournaments in the platform have been completely overhauled to run as self-sufficient, high-performance automated matches entirely stored and tracked by memory sockets on the server side to ensure zero delay or desync for paid entry games!

## 🔧 Work Completed

### 1. The Knockout Engine (`tournament.manager.js`)
Created a standalone memory manager to:
- Actively maintain server-authoritative timers. 
- Auto-pair bracket brackets dynamically from rounds `(16 -> 8 -> 4 -> 2 -> 1)`.
- Advance states automatically from `Lobby Wait (5 minutes) -> Round -> Rest (15s) -> Next Round`.

### 2. Hybrid Qualification System
- Developed a completely custom hybrid scoring rule system for `5 Min Hybrid` types!
- Server automatically scans game `fen()` to track and allocate `+5` points for captured Queens, `+2` for Royston/Knight/Bishops, and `+1` for Pawns!
- Win logic grants `+10` and draw gives `+5`. 
- Qualifies top 16 natively from the 100 queue after exactly 20 seconds.

### 3. Disconnect & Refresh Safety
If the user refreshes their browser at any time during an active Knockout tournament:
- Local storage detects `px_active_match_[id]` presence.
- Socket automatically re-joins the exact server `room` and resyncs the active board state, timer elapsed, and opponent moves.
- They will automatically be greeted with the lobby if they finish their current bracket match early and are waiting for opponents!

### 4. Categorized Filtering UI
Built a 3-tier filtration interface with Dropdowns for `Timer` and `Coin Type`.
- Allows toggling between the 10 available sub-tiers seamlessly (5, 10, 15, ..., 500).
- Automatically collapses to show exactly '2' tournaments per `Timer Type` on Default Load to prevent cluttering according to the UX design wireframe!

> [!SUCCESS]
> The Paid Tournament suite is now 100% synced with GitHub and fully functional without requiring manual admin tracking!
