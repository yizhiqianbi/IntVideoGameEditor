package top.xumeng.app.feature.publish

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.RemoteImage
import top.xumeng.app.core.network.SubmissionRow
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark

private val filters = listOf(
    "drafts" to "私人草稿",
    "all" to "所有投稿",
    "pending" to "待审核",
    "published" to "已发布",
    "rejected" to "已退回",
    "archived" to "已撤回",
)

data class PublishUi(
    val loading: Boolean = true,
    val working: Boolean = false,
    val filter: String = "all",
    val rows: List<SubmissionRow> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val drafts: List<DraftCard> = emptyList(),
)

data class DraftCard(val id: String, val name: String, val blurb: String, val bookCount: Int, val openings: Int, val unfinished: Boolean, val cover: String)

class PublishViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private var accountId: String? = null
    private val mutable = MutableStateFlow(PublishUi())
    val state: StateFlow<PublishUi> = mutable.asStateFlow()

    init { load("drafts") }

    fun load(filter: String) = fetch(filter, reset = true)

    fun more() {
        val current = mutable.value
        if (current.loading || current.loadingMore || current.working || !current.hasMore) return
        fetch(current.filter, reset = false)
    }

    private fun fetch(filter: String, reset: Boolean) {
        val start = if (reset) 0 else mutable.value.rows.size
        viewModelScope.launch {
            mutable.update {
                it.copy(
                    loading = reset && (it.filter != filter || it.rows.isEmpty()),
                    loadingMore = !reset,
                    filter = filter,
                    rows = if (reset && it.filter != filter) emptyList() else it.rows,
                    drafts = if (filter == "drafts") it.drafts else emptyList(),
                    error = null,
                    working = false,
                )
            }
            if (filter == "drafts") {
                val loaded = runCatching { withContext(Dispatchers.IO) { backend.authorDesk().cards } }
                loaded.fold(
                    onSuccess = { cards ->
                        mutable.update {
                            it.copy(
                                loading = false,
                                loadingMore = false,
                                drafts = cards.map { card ->
                                    DraftCard(
                                        card.id,
                                        card.name.ifBlank { "未命名角色" },
                                        card.description.lineSequence().firstOrNull()?.take(80).orEmpty(),
                                        card.lore.size,
                                        card.openings.size,
                                        card.unfinished,
                                        card.cover,
                                    )
                                },
                                rows = emptyList(),
                                total = cards.size,
                                hasMore = false,
                                error = null,
                            )
                        }
                    },
                    onFailure = { error -> mutable.update { it.copy(loading = false, loadingMore = false, error = error.message ?: "草稿没有载入") } },
                )
                return@launch
            }
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    accountId = accountId ?: backend.accountId()
                    backend.submissions(filter, start)
                }
            }
            loaded.fold(
                onSuccess = { page ->
                    mutable.update { current ->
                        val merged = if (reset) page.rows else {
                            val seen = current.rows.map { it.publicationId }.toMutableSet()
                            current.rows + page.rows.filter { seen.add(it.publicationId) }
                        }
                        current.copy(loading = false, loadingMore = false, rows = merged, total = page.total, hasMore = page.hasMore)
                    }
                },
                onFailure = { error -> mutable.update { it.copy(loading = false, loadingMore = false, error = error.message ?: "投稿没有载入") } },
            )
        }
    }

    fun withdraw(row: SubmissionRow) = act(row) { backend.withdrawSubmission(row.submissionId, row.version, it) }

    fun unpublish(row: SubmissionRow) = act(row) { backend.unpublish(row.publicationId, row.version, it) }

    private fun act(row: SubmissionRow, block: (String) -> Unit) {
        val owner = accountId ?: return
        if (mutable.value.working) return
        viewModelScope.launch {
            mutable.update { it.copy(working = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { block(owner) } }
            done.fold(
                onSuccess = { load(mutable.value.filter) },
                onFailure = { error -> mutable.update { it.copy(working = false, error = error.message ?: "没有完成") } },
            )
        }
    }
}

@Composable
fun PublishScreen(onEdit: (String) -> Unit = {}, onCreate: () -> Unit = {}, onChat: (String, String) -> Unit = { _, _ -> }) {
    val model = viewModel<PublishViewModel>()
    val state by model.state.collectAsState()
    var confirm by remember { mutableStateOf<Pair<String, SubmissionRow>?>(null) }
    Box(Modifier.fillMaxSize().background(Ink.background)) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Mark("check", size = 22.dp, color = Ink.accent)
            Text("投稿", color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(start = 10.dp).weight(1f))
            Text("新角色", color = Ink.accent, modifier = Modifier.clickable(onClick = onCreate).padding(8.dp))
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            filters.forEach { (key, label) ->
                Text(
                    label,
                    color = if (state.filter == key) Ink.accent else Ink.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.clickable { model.load(key) }.padding(vertical = 8.dp),
                )
            }
        }
        state.error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }
        when {
            state.loading && ((state.filter == "drafts" && state.drafts.isEmpty()) || (state.filter != "drafts" && state.rows.isEmpty())) -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(if (state.filter == "drafts") "正在读取草稿" else "正在读取投稿", color = Ink.muted) }
            state.filter == "drafts" && state.drafts.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("还没有私人草稿", color = Ink.muted) }
            state.filter == "drafts" -> LazyColumn {
                items(state.drafts, key = { it.id }) { card ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        RemoteImage(BuildConfig.WEB_ORIGIN, card.cover, card.name, Modifier.width(56.dp).height(74.dp))
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(card.name, color = Ink.text, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (card.blurb.isNotBlank()) Text(card.blurb, color = Ink.muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                        Text("私人草稿 · ${card.bookCount} 条世界书${if (card.unfinished) "（待完善）" else ""} · ${card.openings} 条初始消息", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text("继续创作", color = Ink.accent, modifier = Modifier.clickable { onEdit(card.id) }.padding(top = 8.dp))
                            Text("试聊", color = Ink.text, modifier = Modifier.clickable { onChat(card.id, card.name) }.padding(top = 8.dp))
                        }
                    }
                    }
                }
            }
            state.rows.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("这一栏还没有投稿", color = Ink.muted) }
            else -> LazyColumn {
                items(state.rows, key = { it.publicationId }) { row ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        RemoteImage(BuildConfig.WEB_ORIGIN, row.cover, row.name, Modifier.width(56.dp).height(74.dp))
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(row.name, color = Ink.text, fontSize = 16.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        Text(submissionLine(row), color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        if (row.reason.isNotBlank()) Text(row.reason, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            if (row.privateCharacterId.isNotBlank()) Text("编辑 / 重提", color = Ink.accent, modifier = Modifier.clickable { onEdit(row.privateCharacterId) }.padding(top = 8.dp))
                            if (row.status == "pending") Text("撤回", color = Ink.text, modifier = Modifier.clickable(enabled = !state.working) { confirm = "withdraw" to row }.padding(top = 8.dp))
                            if (row.listed) Text("下架", color = Ink.text, modifier = Modifier.clickable(enabled = !state.working) { confirm = "unpublish" to row }.padding(top = 8.dp))
                        }
                    }
                    }
                }
                if (state.hasMore) {
                    item {
                        Text(
                            if (state.loadingMore) "正在加载" else "还有 ${state.total - state.rows.size} 条",
                            color = Ink.text,
                            modifier = Modifier.clickable(enabled = !state.loadingMore) { model.more() }.padding(horizontal = 20.dp, vertical = 12.dp),
                        )
                    }
                }
            }
        }
    }
    confirm?.let { (action, row) ->
        Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { confirm = null })
        Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
            Text(if (action == "withdraw") "撤回本次提交？" else "下架这个角色？", color = Ink.text, fontSize = 18.sp)
            Text(
                if (action == "withdraw") "待审核版本将被撤回，已经上线的旧版本和私人草稿会保留。" else "角色将退出广场，待审核版本也会撤回。私人草稿会保留。",
                color = Ink.muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("取消", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.working) { confirm = null }.padding(vertical = 8.dp))
                Text("确认", color = Ink.text, modifier = Modifier.clickable(enabled = !state.working) {
                    if (action == "withdraw") model.withdraw(row) else model.unpublish(row)
                    confirm = null
                }.padding(vertical = 8.dp))
            }
        }
    }
    }
}

private fun submissionLine(row: SubmissionRow): String {
    val whenText = if (row.createdAt <= 0) "" else " · " + java.time.format.DateTimeFormatter.ofPattern("M月d日 HH:mm")
        .withZone(java.time.ZoneId.of("Asia/Shanghai"))
        .format(java.time.Instant.ofEpochMilli(row.createdAt))
    val live = when {
        row.listed && row.status != "approved" -> " · 上一版本已上线"
        !row.listed && row.approvedRevision != null -> " · 已下架"
        row.listed -> " · 在线上"
        else -> ""
    }
    return "${statusName(row.status)} · 第 ${row.revision} 版$whenText$live"
}

private fun statusName(status: String) = when (status) {
    "pending" -> "待审核"
    "approved" -> "已批准"
    "rejected" -> "已退回"
    "withdrawn" -> "已撤回"
    else -> status
}
