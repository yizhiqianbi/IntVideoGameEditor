package top.xumeng.app.feature.forum

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
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
import top.xumeng.app.core.network.ForumPost
import top.xumeng.app.core.network.ForumThread
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark

private val boards = listOf(
    "" to "全部",
    "characters" to "角色与创作",
    "social" to "互动交友",
    "life" to "生活交流",
    "help" to "站务与求助",
    "real" to "真人专区",
)

data class ForumUi(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val category: String = "",
    val query: String = "",
    val tag: String = "",
    val popularTags: List<String> = emptyList(),
    val posts: List<ForumPost> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val thread: ForumThread? = null,
    val composing: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val accountId: String = "",
    val guest: Boolean = true,
)

class ForumViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow(ForumUi())
    val state: StateFlow<ForumUi> = mutable.asStateFlow()

    init { load("") }

    fun load(category: String) = fetch(category, reset = true)

    fun search(text: String) {
        mutable.update { it.copy(query = text.trim().take(120), posts = emptyList()) }
        fetch(mutable.value.category, reset = true)
    }

    fun pickTag(tag: String) {
        val clean = tag.trim().take(40)
        mutable.update { it.copy(tag = if (it.tag == clean) "" else clean, posts = emptyList()) }
        fetch(mutable.value.category, reset = true)
    }

    fun more() {
        val current = mutable.value
        if (current.loading || current.loadingMore || current.busy || !current.hasMore) return
        fetch(current.category, reset = false)
    }

    fun vote(value: Int) {
        val post = mutable.value.thread?.post ?: return
        val next = if (post.mine == value) 0 else value
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val voted = runCatching { withContext(Dispatchers.IO) { backend.forumVote(post.id, next) } }
            voted.fold(
                onSuccess = { updated ->
                    mutable.update { state ->
                        state.copy(
                            busy = false,
                            thread = state.thread?.copy(post = updated),
                            posts = state.posts.map { if (it.id == updated.id) updated else it },
                        )
                    }
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "投票没有记下") } },
            )
        }
    }

    private fun fetch(category: String, reset: Boolean) {
        val start = if (reset) 0 else mutable.value.posts.size
        viewModelScope.launch {
            mutable.update {
                it.copy(
                    loading = reset && (it.category != category || it.posts.isEmpty()),
                    loadingMore = !reset,
                    category = category,
                    posts = if (reset && it.category != category) emptyList() else it.posts,
                    error = null,
                )
            }
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val page = backend.forumPosts(category, start, mutable.value.query, mutable.value.tag)
                    page to backend.viewer()
                }
            }
            loaded.fold(
                onSuccess = { (page, account) ->
                    mutable.update { state ->
                        val merged = if (reset) page.posts else {
                            val seen = state.posts.map { it.id }.toMutableSet()
                            state.posts + page.posts.filter { seen.add(it.id) }
                        }
                        state.copy(loading = false, loadingMore = false, posts = merged, total = page.total, hasMore = page.hasMore, popularTags = page.popularTags.ifEmpty { state.popularTags }, accountId = account.id, guest = account.guest)
                    }
                },
                onFailure = { error -> mutable.update { it.copy(loading = false, loadingMore = false, error = error.message ?: "论坛没有载入") } },
            )
        }
    }

    fun open(id: String) {
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.forumPost(id) } }
            loaded.fold(
                onSuccess = { thread -> mutable.update { it.copy(busy = false, thread = thread, composing = false) } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "帖子没有打开") } },
            )
        }
    }

    fun moreReplies() {
        val thread = mutable.value.thread ?: return
        if (!thread.repliesHaveMore || mutable.value.busy) return
        val offset = thread.replies.size
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.forumPost(thread.post.id, offset) } }
            loaded.fold(
                onSuccess = { page ->
                    mutable.update { state ->
                        val current = state.thread ?: return@update state.copy(busy = false)
                        val seen = current.replies.map { it.id }.toMutableSet()
                        state.copy(busy = false, thread = current.copy(post = page.post, replies = current.replies + page.replies.filter { seen.add(it.id) }, replyTotal = page.replyTotal, repliesHaveMore = page.repliesHaveMore))
                    }
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "回复没有载入") } },
            )
        }
    }

    fun savePost(title: String, body: String, tags: String) {
        val post = mutable.value.thread?.post ?: return
        if (post.authorId.isBlank() || post.authorId != mutable.value.accountId) return
        val cleanTitle = title.trim()
        val cleanBody = body.trim()
        if (cleanTitle.isEmpty() || cleanBody.isEmpty()) {
            mutable.update { it.copy(error = "标题和正文不能为空") }
            return
        }
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val saved = runCatching { withContext(Dispatchers.IO) { backend.updateForumPost(post, cleanTitle, cleanBody, forumTagList(tags)) } }
            saved.fold(
                onSuccess = { updated ->
                    mutable.update { state ->
                        state.copy(busy = false, thread = state.thread?.copy(post = updated), posts = state.posts.map { if (it.id == updated.id) updated else it })
                    }
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "帖子没有保存") } },
            )
        }
    }

    fun deletePost() {
        val post = mutable.value.thread?.post ?: return
        if (post.authorId.isBlank() || post.authorId != mutable.value.accountId) return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.deleteForumPost(post.id) } }
            done.fold(
                onSuccess = {
                    mutable.update { it.copy(busy = false, thread = null, posts = it.posts.filterNot { item -> item.id == post.id }) }
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "帖子没有删除") } },
            )
        }
    }

    fun deleteReply(id: String) {
        val reply = mutable.value.thread?.replies?.find { it.id == id } ?: return
        if (reply.authorId.isBlank() || reply.authorId != mutable.value.accountId) return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.deleteForumReply(id) } }
            done.fold(
                onSuccess = {
                    mutable.update { state ->
                        val thread = state.thread ?: return@update state.copy(busy = false)
                        state.copy(busy = false, thread = thread.copy(replies = thread.replies.filterNot { it.id == id }, replyTotal = (thread.replyTotal - 1).coerceAtLeast(0)))
                    }
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "回复没有删除") } },
            )
        }
    }

    fun report(reason: String, onDone: () -> Unit) {
        val post = mutable.value.thread?.post ?: return
        val clean = reason.trim()
        if (clean.isEmpty()) {
            mutable.update { it.copy(error = "请说明需要管理员处理的问题", notice = null) }
            return
        }
        if (mutable.value.guest) {
            mutable.update { it.copy(error = "请先注册或登录，再参与广场讨论。", notice = null) }
            return
        }
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null, notice = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.reportForumPost(post.id, clean) } }
            done.fold(
                onSuccess = {
                    mutable.update { it.copy(busy = false, notice = "举报已提交，等待管理员处理。") }
                    onDone()
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "举报没有提交") } },
            )
        }
    }

    fun note(message: String) { mutable.update { it.copy(notice = message, error = null) } }

    fun close() { mutable.update { it.copy(thread = null, composing = false, error = null, notice = null) } }

    fun compose(open: Boolean) { mutable.update { it.copy(composing = open, error = null) } }

    fun reply(text: String) {
        val id = mutable.value.thread?.post?.id ?: return
        val body = text.trim()
        if (body.isEmpty()) return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.forumReply(id, body) } }
            done.fold(
                onSuccess = { reply ->
                    mutable.update { state ->
                        val thread = state.thread ?: return@update state.copy(busy = false)
                        val replies = if (thread.replies.any { it.id == reply.id }) thread.replies else thread.replies + reply
                        state.copy(busy = false, thread = thread.copy(replies = replies, replyTotal = thread.replyTotal + 1))
                    }
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "回复没有发出") } },
            )
        }
    }

    fun create(title: String, body: String, category: String, tags: String) {
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.forumCreate(title.trim(), body.trim(), category.ifBlank { "life" }, forumTagList(tags)) } }
            done.fold(
                onSuccess = { mutable.update { it.copy(busy = false, composing = false) }; load(mutable.value.category) },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "帖子没有发出") } },
            )
        }
    }
}

@Composable
fun ForumScreen(focus: String? = null, onFocusConsumed: () -> Unit = {}) {
    val model = viewModel<ForumViewModel>()
    val state by model.state.collectAsState()
    LaunchedEffect(focus) {
        val id = focus ?: return@LaunchedEffect
        model.open(id)
        onFocusConsumed()
    }
    when {
        state.thread != null -> ForumDetail(state, model::close, model::reply, model::vote, model::moreReplies, model::savePost, model::deletePost, model::deleteReply, model::report, model::note)
        state.composing -> ForumCompose(state.busy, state.error, model::compose, model::create)
        else -> ForumList(state, model::load, model::more, model::open, model::compose, model::search, model::pickTag)
    }
}

@Composable
private fun ForumList(state: ForumUi, load: (String) -> Unit, more: () -> Unit, open: (String) -> Unit, compose: (Boolean) -> Unit, search: (String) -> Unit, pickTag: (String) -> Unit) {
    var draft by rememberSaveable { mutableStateOf(state.query) }
    Column(Modifier.fillMaxSize().background(Ink.background)) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Mark("compass", size = 22.dp, color = Ink.accent)
            Text("论坛", color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(start = 10.dp).weight(1f))
            Text("发帖", color = Ink.text, modifier = Modifier.clickable { compose(true) }.padding(8.dp))
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            boards.forEach { (id, label) ->
                Text(label, color = if (state.category == id) Ink.accent else Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { load(id) }.padding(vertical = 8.dp))
            }
        }
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            TextField(draft, { draft = it.take(120) }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("搜索主题") }, colors = fieldColors())
            Text("搜索", color = Ink.text, modifier = Modifier.clickable { search(draft) }.padding(start = 12.dp))
        }
        if (state.popularTags.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                state.popularTags.forEach { tag ->
                    Text("#$tag", color = if (state.tag == tag) Ink.accent else Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { pickTag(tag) })
                }
            }
        }
        when {
            state.loading && state.posts.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("正在读取论坛", color = Ink.muted) }
            state.posts.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(state.error ?: if (state.query.isNotBlank() || state.tag.isNotBlank()) "没有找到主题" else "这一栏还没有帖子", color = Ink.muted)
            }
            else -> LazyColumn {
                items(state.posts, key = { it.id }) { post ->
                    Column(Modifier.fillMaxWidth().clickable { open(post.id) }.padding(horizontal = 20.dp, vertical = 14.dp)) {
                        Text(post.title, color = Ink.text, fontSize = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (post.tags.isNotEmpty()) {
                            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                post.tags.take(6).forEach { tag ->
                                    Text("#$tag", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.clickable { pickTag(tag) })
                                }
                            }
                        }
                        Text("${post.author} · ${post.replies} 条回复 · ${post.up - post.down}", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                }
                if (state.hasMore) {
                    item {
                        Text(
                            if (state.loadingMore) "正在加载" else "还有 ${state.total - state.posts.size} 条",
                            color = Ink.text,
                            modifier = Modifier.clickable(enabled = !state.loadingMore, onClick = more).padding(horizontal = 20.dp, vertical = 12.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ForumDetail(state: ForumUi, close: () -> Unit, reply: (String) -> Unit, vote: (Int) -> Unit, more: () -> Unit, save: (String, String, String) -> Unit, deletePost: () -> Unit, deleteReply: (String) -> Unit, report: (String, () -> Unit) -> Unit, note: (String) -> Unit) {
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val thread = state.thread ?: return
    var text by rememberSaveable(thread.post.id) { mutableStateOf("") }
    var reporting by remember(thread.post.id) { mutableStateOf(false) }
    var reason by remember(thread.post.id) { mutableStateOf("") }
    var editing by remember(thread.post.id) { mutableStateOf(false) }
    var title by remember(thread.post.updatedAt) { mutableStateOf(thread.post.title) }
    var body by remember(thread.post.updatedAt) { mutableStateOf(thread.post.body) }
    var tags by remember(thread.post.updatedAt) { mutableStateOf(thread.post.tags.joinToString("，")) }
    var tagError by remember(thread.post.id) { mutableStateOf<String?>(null) }
    var pendingDelete by remember(thread.post.id) { mutableStateOf<String?>(null) }
    val mine = thread.post.authorId.isNotBlank() && thread.post.authorId == state.accountId
    Box(Modifier.fillMaxSize().background(Ink.background)) {
    Column(Modifier.fillMaxSize().imePadding()) {
        Text("返回", color = Ink.muted, modifier = Modifier.clickable(onClick = close).padding(16.dp))
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp)) {
            item {
                if (editing) {
                    TextField(title, { title = it.take(120) }, modifier = Modifier.fillMaxWidth(), placeholder = { Text("标题") }, colors = fieldColors())
                    TextField(body, { body = it.take(12_000) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), minLines = 4, placeholder = { Text("正文") }, colors = fieldColors())
                    TextField(tags, { tags = it.take(409) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), placeholder = { Text("标签，用逗号分开") }, colors = fieldColors())
                    Text(if (state.busy) "保存中" else "保存修改", color = Ink.text, modifier = Modifier.clickable(enabled = !state.busy) {
                        val parsed = runCatching { forumTagList(tags) }
                        val failure = parsed.exceptionOrNull()?.message
                        if (failure != null) {
                            tagError = failure
                            return@clickable
                        }
                        tagError = null
                        save(title, body, tags)
                        editing = false
                    }.padding(vertical = 8.dp))
                    tagError?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp) }
                } else {
                    Text(thread.post.title, color = Ink.text, fontSize = 20.sp)
                    if (thread.post.tags.isNotEmpty()) Text(thread.post.tags.joinToString(" · ") { "#$it" }, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                    Text(thread.post.body, color = Ink.text, fontSize = 15.sp, lineHeight = 22.sp, modifier = Modifier.padding(top = 12.dp))
                }
                Text(thread.post.author, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp))
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(if (thread.post.mine == 1) "已赞同 ${thread.post.up}" else "赞同 ${thread.post.up}", color = if (thread.post.mine == 1) Ink.accent else Ink.muted, modifier = Modifier.clickable(enabled = !state.busy) { vote(1) })
                    Text(if (thread.post.mine == -1) "已反对 ${thread.post.down}" else "反对 ${thread.post.down}", color = if (thread.post.mine == -1) Ink.accent else Ink.muted, modifier = Modifier.clickable(enabled = !state.busy) { vote(-1) })
                    Text(if (reporting) "取消举报" else "举报", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.busy) { reporting = !reporting })
                    Text("复制链接", color = Ink.muted, modifier = Modifier.clickable {
                        clipboard.setText(androidx.compose.ui.text.AnnotatedString("${top.xumeng.app.BuildConfig.WEB_ORIGIN}/#forum/post/${thread.post.id}"))
                        note("主题链接已复制。")
                    })
                    if (mine) {
                        Text(if (editing) "取消编辑" else "编辑", color = Ink.accent, modifier = Modifier.clickable { editing = !editing })
                        Text("删除帖子", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.busy) { pendingDelete = "post" })
                    }
                }
                if (reporting) {
                    TextField(reason, { reason = it.take(1000) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), minLines = 3, placeholder = { Text("请说明需要管理员处理的问题") }, colors = fieldColors())
                    Text("${reason.length} / 1000", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                    Text(if (state.busy) "正在提交" else "提交举报", color = Ink.text, modifier = Modifier.clickable(enabled = !state.busy && reason.isNotBlank()) {
                        report(reason) { reporting = false; reason = "" }
                    }.padding(vertical = 8.dp))
                }
            }
            items(thread.replies, key = { it.id }) { item ->
                Column(Modifier.padding(top = 16.dp)) {
                    Text(item.author, color = Ink.muted, fontSize = 12.sp)
                    Text(item.body, color = Ink.text, fontSize = 15.sp, modifier = Modifier.padding(top = 4.dp))
                    if (item.authorId.isNotBlank() && item.authorId == state.accountId) {
                        Text("删除", color = Color(0xFFFF8AA3), fontSize = 12.sp, modifier = Modifier.clickable(enabled = !state.busy) { pendingDelete = "reply:${item.id}" }.padding(top = 4.dp))
                    }
                }
            }
            if (thread.repliesHaveMore) {
                item {
                    Text(
                        if (state.busy) "正在加载" else "还有 ${thread.replyTotal - thread.replies.size} 条回复",
                        color = Ink.text,
                        modifier = Modifier.clickable(enabled = !state.busy, onClick = more).padding(vertical = 16.dp),
                    )
                }
            }
        }
        state.notice?.let { Text(it, color = Ink.accent, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp)) }
        state.error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp)) }
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextField(
                value = text,
                onValueChange = { text = it.take(4000) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("写回复") },
                colors = fieldColors(),
            )
            Text("发送", color = Ink.text, modifier = Modifier.clickable(enabled = !state.busy) { val value = text; text = ""; reply(value) }.padding(12.dp))
        }
    }
    pendingDelete?.let { pending ->
        val replyId = pending.removePrefix("reply:").takeIf { pending.startsWith("reply:") }
        Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { pendingDelete = null })
        Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
            Text(if (replyId == null) "删除主题" else "删除回复", color = Ink.text, fontSize = 18.sp)
            Text(
                if (replyId == null) "删除后，主题、回复和投票都会移除。确定删除吗？" else "这条回复将被永久删除。确定删除吗？",
                color = Ink.muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("取消", color = Ink.muted, modifier = Modifier.clickable { pendingDelete = null }.padding(vertical = 8.dp))
                Text(if (state.busy) "正在删除…" else "确认删除", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.busy) {
                    if (replyId == null) deletePost() else deleteReply(replyId)
                    pendingDelete = null
                }.padding(vertical = 8.dp))
            }
        }
    }
    }
}

@Composable
private fun ForumCompose(busy: Boolean, error: String?, cancel: (Boolean) -> Unit, create: (String, String, String, String) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var body by rememberSaveable { mutableStateOf("") }
    var tags by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("life") }
    Column(Modifier.fillMaxSize().background(Ink.background).imePadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text("取消", color = Ink.muted, modifier = Modifier.clickable { cancel(false) }.padding(bottom = 8.dp))
        Text("新帖子", color = Ink.text, fontSize = 22.sp)
        TextField(title, { title = it.take(120) }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), placeholder = { Text("标题") }, colors = fieldColors())
        TextField(body, { body = it.take(12_000) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), minLines = 6, placeholder = { Text("正文") }, colors = fieldColors())
        TextField(tags, { tags = it.take(409) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), placeholder = { Text("标签，用逗号分开") }, colors = fieldColors())
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            boards.filter { it.first.isNotEmpty() }.forEach { (id, label) ->
                Text(label, color = if (category == id) Ink.accent else Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { category = id }.padding(vertical = 8.dp))
            }
        }
        Text(if (busy) "发送中" else "发布", color = Ink.text, modifier = Modifier.clickable(enabled = !busy && title.isNotBlank() && body.isNotBlank()) { create(title, body, category, tags) }.padding(vertical = 12.dp))
        error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp) }
    }
}

private fun forumTagList(text: String): List<String> {
    val tags = text.split(',', '，', '\n').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    if (tags.size > 10 || tags.any { it.length > 40 }) throw IllegalArgumentException("最多添加 10 个标签，每个标签不超过 40 个字符")
    return tags
}

@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Ink.surface,
    unfocusedContainerColor = Ink.surface,
    focusedTextColor = Ink.text,
    unfocusedTextColor = Ink.text,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
    cursorColor = Ink.accent,
)
