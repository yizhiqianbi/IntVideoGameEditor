package top.xumeng.app.feature.studio

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.GameDraft
import top.xumeng.app.core.network.GameRules
import top.xumeng.app.core.network.GameSummary
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark
import java.io.IOException
import java.util.UUID

data class GameUi(
    val screen: Boolean = false,
    val guest: Boolean = true,
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val saving: Boolean = false,
    val games: List<GameSummary> = emptyList(),
    val draft: GameDraft? = null,
    val error: String? = null,
    val listError: String? = null,
    val notice: String? = null,
    val dirty: Boolean = false,
)

private data class GameLoad(val id: String, val guest: Boolean, val games: List<GameSummary>)

class GameViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow(GameUi())
    val state: StateFlow<GameUi> = mutable.asStateFlow()
    private var accountId: String? = null
    private var saved: GameDraft? = null
    private var generation = 0
    private var action = 0

    fun showGuest() {
        accountId = null
        saved = null
        generation += 1
        action += 1
        mutable.update { GameUi(screen = it.screen, guest = true, loaded = true) }
    }

    fun openLibrary(guest: Boolean) {
        if (guest) {
            showGuest()
            mutable.update { it.copy(screen = true) }
            return
        }
        mutable.update { it.copy(screen = true, guest = false) }
        refresh()
    }

    fun closeScreen() {
        saved = null
        mutable.update { it.copy(screen = false, draft = null, dirty = false, error = null, notice = null) }
    }

    fun closeDraft() {
        saved = null
        mutable.update { it.copy(draft = null, dirty = false, error = null, notice = null) }
    }

    fun refresh() {
        val ticket = ++generation
        mutable.update { it.copy(loading = it.draft == null, listError = null) }
        viewModelScope.launch {
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val session = backend.ensureSession()
                    if (session.user.guest) GameLoad(session.user.id, true, emptyList())
                    else GameLoad(session.user.id, false, backend.gameList(session.user.id))
                }
            }
            if (ticket != generation) return@launch
            loaded.fold(
                onSuccess = { result ->
                    if (result.guest) {
                        accountId = null
                        saved = null
                        mutable.update { GameUi(screen = it.screen, guest = true, loaded = true) }
                        return@fold
                    }
                    val switched = accountId != null && accountId != result.id
                    accountId = result.id
                    if (switched) saved = null
                    mutable.update {
                        it.copy(
                            loading = false,
                            loaded = true,
                            guest = false,
                            games = result.games,
                            listError = null,
                            draft = if (switched) null else it.draft,
                            dirty = if (switched) false else it.dirty,
                            error = if (switched) null else it.error,
                            notice = if (switched) null else it.notice,
                        )
                    }
                },
                onFailure = { error ->
                    mutable.update { it.copy(loading = false, loaded = true, listError = error.message ?: "作品未能加载，可刷新重试。") }
                },
            )
        }
    }

    fun open(id: String) {
        val owner = accountId
        if (owner == null) {
            mutable.update { it.copy(screen = true, guest = true, error = "请登录后打开私人游戏。") }
            return
        }
        if (mutable.value.saving) return
        val ticket = ++action
        mutable.update { it.copy(screen = true, saving = true, error = null, notice = null) }
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.game(owner, id) } }
            if (ticket != action) return@launch
            loaded.fold(
                onSuccess = { draft ->
                    if (accountId != owner) {
                        mutable.update { it.copy(saving = false, error = "游戏所属账号无效，请重新加载。") }
                        return@fold
                    }
                    saved = draft
                    mutable.update { it.copy(saving = false, guest = false, draft = draft, dirty = false) }
                },
                onFailure = { error ->
                    mutable.update { it.copy(saving = false, error = error.message ?: "游戏请求失败，当前源码已保留。") }
                },
            )
        }
    }

    fun createBlank() {
        if (mutable.value.saving || mutable.value.guest || accountId == null) return
        val draft = GameDraft(
            id = UUID.randomUUID().toString(),
            title = "新游戏",
            synopsis = "",
            source = GameRules.blankSource,
        )
        saved = null
        mutable.update { it.copy(draft = draft, dirty = true, error = null, notice = null, guest = false) }
    }

    fun edit(block: (GameDraft) -> GameDraft) {
        if (mutable.value.saving) return
        val current = mutable.value.draft ?: return
        val next = block(current)
        mutable.update { it.copy(draft = next, dirty = next.version == null || !sameGame(saved, next), notice = null, error = null) }
    }

    fun report(message: String) {
        mutable.update { it.copy(error = message) }
    }

    fun save() {
        val owner = accountId ?: return
        val draft = mutable.value.draft ?: return
        if (mutable.value.saving || mutable.value.guest || !mutable.value.dirty) return
        val ticket = ++action
        mutable.update { it.copy(saving = true, error = null, notice = null) }
        viewModelScope.launch {
            val savedDraft = runCatching {
                withContext(Dispatchers.IO) {
                    val session = backend.ensureSession()
                    if (session.user.guest) throw IOException("请先登录，再保存私人游戏。")
                    if (session.user.id != owner) throw IOException("当前账号已改变，请重新加载作品。源码仍保留在原账号草稿中。")
                    backend.saveGame(owner, draft)
                }
            }
            if (ticket != action) return@launch
            savedDraft.fold(
                onSuccess = { next ->
                    if (accountId != owner) {
                        mutable.update { it.copy(saving = false, error = "当前账号已改变，请重新加载作品。源码仍保留在原账号草稿中。") }
                        return@fold
                    }
                    saved = next
                    val summary = GameSummary(
                        next.id,
                        next.title,
                        next.synopsis,
                        next.version ?: 1L,
                        next.createdAt,
                        next.updatedAt,
                        GameRules.utf8Bytes(next.source),
                    )
                    mutable.update { state ->
                        state.copy(
                            saving = false,
                            draft = next,
                            dirty = false,
                            notice = "已保存到私人作品。可从创作中心重新打开。",
                            games = listOf(summary) + state.games.filter { it.id != next.id },
                        )
                    }
                },
                onFailure = { error ->
                    mutable.update { it.copy(saving = false, error = error.message ?: "游戏请求失败，当前源码已保留。") }
                },
            )
        }
    }
}

private fun sameGame(saved: GameDraft?, draft: GameDraft): Boolean {
    if (saved == null) return false
    return saved.id == draft.id && saved.title == draft.title && saved.synopsis == draft.synopsis && saved.source == draft.source
}

private const val editorBytes = 1024L * 1024L

private val gameClock = java.time.format.DateTimeFormatter.ofPattern("yyyy/M/d HH:mm", java.util.Locale.CHINA)
    .withZone(java.time.ZoneId.of("Asia/Shanghai"))

private fun formatSize(bytes: Long): String {
    return if (bytes >= 1024L * 1024L) String.format(java.util.Locale.US, "%.2f MB", bytes / 1024.0 / 1024.0)
    else String.format(java.util.Locale.US, "%.1f KB", bytes / 1024.0)
}

@Composable
fun GameStudioScreen(state: GameUi, model: GameViewModel, onAccount: () -> Unit) {
    val draft = state.draft
    val busy = state.saving || state.loading
    var discard by remember { mutableStateOf<(() -> Unit)?>(null) }
    fun leave(action: () -> Unit) {
        if (draft != null && state.dirty) discard = action else action()
    }
    Box(Modifier.fillMaxSize().background(Ink.background)) {
        Column(Modifier.fillMaxSize().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                val backLabel = if (draft != null) "返回游戏作品列表" else "返回创作中心"
                Box(
                    Modifier.size(44.dp).semantics { contentDescription = backLabel }.clickable(enabled = !busy) {
                        if (draft != null) leave(model::closeDraft) else model.closeScreen()
                    },
                    contentAlignment = Alignment.Center,
                ) { Mark("back", color = if (busy) Ink.line else Ink.text) }
                Column(Modifier.weight(1f)) {
                    Text("创作中心 / 游戏", color = Ink.muted, fontSize = 12.sp)
                    Text(draft?.title?.takeIf { it.isNotEmpty() } ?: "游戏创作", color = Ink.text, fontSize = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Text(
                when {
                    draft == null -> "网页游戏 · HTML、压缩包与试玩"
                    busy -> "正在保存或加载…"
                    state.dirty -> "尚未保存"
                    else -> "私人作品 · 已保存 v${draft.version ?: 1}"
                },
                color = Ink.muted,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp),
            )
            Row(Modifier.padding(start = 16.dp, top = 10.dp, bottom = 6.dp)) {
                if (draft == null) {
                    ActionChip("新建游戏", "plus", !busy) {
                        if (state.guest) onAccount() else model.createBlank()
                    }
                } else {
                    ActionChip("保存", "check", !busy && state.dirty, model::save)
                }
            }
            val alert = state.error ?: if (draft == null) state.listError else null
            state.notice?.let { Text(it, color = Ink.accent, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
            alert?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
            if (draft == null) GameLibrary(state, model, onAccount, Modifier.weight(1f))
            else GameEditor(state, model, Modifier.weight(1f))
        }
        discard?.let { action ->
            Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { discard = null })
            Column(
                Modifier.align(Alignment.Center).padding(28.dp).clip(RoundedCornerShape(12.dp)).background(Ink.surface).clickable {}.padding(20.dp),
            ) {
                Text("当前游戏尚未保存。继续会丢掉编辑器里的修改。", color = Ink.text, fontSize = 16.sp)
                Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Text("留下", color = Ink.muted, modifier = Modifier.clickable { discard = null }.padding(vertical = 8.dp))
                    Text("继续", color = Ink.accent, modifier = Modifier.clickable {
                        discard = null
                        action()
                    }.padding(vertical = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun GameLibrary(state: GameUi, model: GameViewModel, onAccount: () -> Unit, modifier: Modifier) {
    var search by remember { mutableStateOf("") }
    val needle = search.trim()
    val results = state.games.filter { game ->
        needle.isEmpty() || "${game.title} ${game.synopsis}".lowercase().contains(needle.lowercase())
    }
    val busy = state.saving || state.loading
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 28.dp)) {
        item {
            Text("新建游戏", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink.surface).clickable(enabled = !busy) {
                    if (state.guest) onAccount() else model.createBlank()
                }.padding(14.dp).semantics { contentDescription = "空白页面" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("空白页面", color = Ink.text, fontSize = 15.sp)
                    Text("从空的 HTML 开始写自己的游戏。可玩的成人游戏在聊天里的游戏列表。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                }
                Mark("chevron", size = 16.dp, color = Ink.muted)
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(top = 22.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("我的游戏 ${if (state.guest) 0 else state.games.size}", color = Ink.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
                Row(
                    Modifier.clickable(enabled = !state.guest && !busy) { model.refresh() },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Mark("refresh", size = 15.dp, color = Ink.muted)
                    Text("刷新", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        if (state.guest) {
            item {
                Column(Modifier.fillMaxWidth().background(Ink.surface, RoundedCornerShape(12.dp)).padding(14.dp)) {
                    Text("登录后可选择模板、编写源码，并保存到私人作品。", color = Ink.muted, fontSize = 13.sp)
                    Text("登录并创作", color = Ink.accent, fontSize = 14.sp, modifier = Modifier.clickable(onClick = onAccount).padding(top = 8.dp))
                }
            }
        } else {
            item {
                TextField(
                    value = search,
                    onValueChange = { search = it },
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).semantics { contentDescription = "搜索我的游戏" },
                    singleLine = true,
                    placeholder = { Text("搜索游戏名称或简介") },
                    leadingIcon = { Mark("search", color = Ink.muted) },
                    colors = fieldColors(),
                )
            }
            when {
                state.loading -> item { Text("正在加载私人作品…", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 12.dp)) }
                results.isNotEmpty() -> items(results, key = { it.id }) { game ->
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !state.saving) { model.open(game.id) }.padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(40.dp).background(Ink.line, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                            Mark("compass", color = Ink.muted)
                        }
                        Column(Modifier.padding(start = 12.dp).weight(1f)) {
                            Text(game.title, color = Ink.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(game.synopsis.ifBlank { "暂无简介" }, color = Ink.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                            Text(
                                "${formatSize(game.sourceBytes)} · v${game.version} · ${gameClock.format(java.time.Instant.ofEpochMilli(game.updatedAt))}",
                                color = Ink.muted,
                                fontSize = 11.sp,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                        Mark("chevron", size = 16.dp, color = Ink.muted)
                    }
                }
                else -> item {
                    val message = when {
                        needle.isNotEmpty() -> "没有匹配的游戏。"
                        state.listError != null || state.error != null -> "作品未能加载，可刷新重试。"
                        else -> "还没有私人游戏。可以新建空白页面，或导入 HTML。"
                    }
                    Text(message, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 12.dp))
                }
            }
        }
    }
}

@Composable
private fun GameEditor(state: GameUi, model: GameViewModel, modifier: Modifier) {
    val draft = state.draft ?: return
    val bytes = remember(draft.source) { GameRules.utf8Bytes(draft.source) }
    val large = bytes > editorBytes
    Column(modifier.padding(horizontal = 16.dp)) {
        FieldLabel("游戏名称")
        TextField(
            value = draft.title,
            onValueChange = { value -> model.edit { it.copy(title = value.take(120)) } },
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "游戏名称" },
            singleLine = true,
            enabled = !state.saving,
            colors = fieldColors(),
        )
        FieldLabel("游戏简介")
        TextField(
            value = draft.synopsis,
            onValueChange = { value -> model.edit { it.copy(synopsis = value.take(4000)) } },
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "游戏简介" },
            minLines = 2,
            maxLines = 4,
            enabled = !state.saving,
            colors = fieldColors(),
        )
        Row(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("HTML 源码", color = Ink.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
            Text(
                "${formatSize(bytes)} / 8 MB",
                color = if (bytes > GameRules.MAX_SOURCE_BYTES) Color(0xFFFF8AA3) else Ink.muted,
                fontSize = 12.sp,
            )
        }
        if (large) {
            Column(Modifier.fillMaxWidth().background(Ink.surface, RoundedCornerShape(12.dp)).padding(14.dp)) {
                Text("这部作品有 ${formatSize(bytes)}，已经包含页面、脚本和图片。", color = Ink.text, fontSize = 14.sp)
                Text("超过 1 MB 的源码不在编辑框里展开。名称和简介可以改，保存时仍提交原来的源码。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            }
        } else {
            TextField(
                value = draft.source,
                onValueChange = { value ->
                    if (value.length.toLong() > GameRules.MAX_SOURCE_BYTES) model.report("游戏源码无效。")
                    else model.edit { it.copy(source = value) }
                },
                modifier = Modifier.fillMaxWidth().weight(1f).semantics { contentDescription = "HTML 游戏源码" },
                enabled = !state.saving,
                colors = fieldColors(),
            )
        }
        Text("名称最多 120 字，简介最多 4000 字。源码按 UTF-8 计算，最多 8 MB。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp, bottom = 16.dp))
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
}

@Composable
private fun ActionChip(label: String, icon: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(8.dp)).background(if (enabled) Ink.accent else Ink.line).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Mark(icon, size = 16.dp, color = Color.White)
        Text(label, color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(start = 6.dp))
    }
}

@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Ink.surface,
    unfocusedContainerColor = Ink.surface,
    disabledContainerColor = Ink.surface,
    focusedTextColor = Ink.text,
    unfocusedTextColor = Ink.text,
    disabledTextColor = Ink.text,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
    disabledIndicatorColor = Color.Transparent,
    cursorColor = Ink.accent,
    focusedPlaceholderColor = Ink.muted,
    unfocusedPlaceholderColor = Ink.muted,
)
