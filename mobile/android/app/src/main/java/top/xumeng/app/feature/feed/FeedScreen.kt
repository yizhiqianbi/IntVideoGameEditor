package top.xumeng.app.feature.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.distinctUntilChanged
import top.xumeng.app.core.network.RemoteImage
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(model: FeedViewModel, onOpen: (CatalogCard, Int, Boolean) -> Unit, onTopic: (String) -> Unit) {
    val state by model.state.collectAsState()
    LaunchedEffect(Unit) { model.syncLayout() }
    val detail = state.detail
    if (state.openingDetail || detail != null || state.detailError != null) {
        CharacterDetail(model.origin, state, detail, model::closeDetail, model::toggleFavorite, model::toggleLike, onOpen, model::toggleFollow, model::openAuthor, model::shareCharacter)
        return
    }
    var draft by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Ink.background)) {
        Text("叙梦", color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
        TextField(
            value = draft,
            onValueChange = { draft = it.take(40) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            singleLine = true,
            placeholder = { Text("搜索角色") },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { model.search(draft) }),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Ink.surface,
                unfocusedContainerColor = Ink.surface,
                focusedTextColor = Ink.text,
                unfocusedTextColor = Ink.text,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Ink.accent,
            ),
        )
        if (state.shelfAuthor.isNotBlank()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("返回广场", color = Ink.muted, modifier = Modifier.clickable { model.closeAuthor() }.padding(end = 12.dp))
                Text(state.shelfAuthorName, color = Ink.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
                val following = state.shelfAuthor in state.followed
                Text(if (following) "已关注" else "关注", color = if (following) Ink.accent else Ink.text, modifier = Modifier.clickable { model.toggleFollow(state.shelfAuthor) })
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            listOf("" to "全部", "following" to "关注", "favorites" to "收藏", "大世界" to "大世界", "仙侠古风" to "仙侠古风", "奇幻" to "奇幻", "都市" to "都市", "剧情" to "剧情", "修仙" to "修仙", "都市异能" to "都市异能", "人生模拟" to "人生模拟").forEach { (id, label) ->
                Text(label, color = if (state.category == id) Ink.accent else Ink.muted, fontSize = 14.sp, modifier = Modifier.clickable { model.category(id) }.padding(vertical = 4.dp))
            }
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            listOf("hot" to "热门", "new" to "最新", "likes" to "喜欢").forEach { (id, label) ->
                Text(label, color = if (state.sort == id) Ink.accent else Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { model.sort(id) }.padding(bottom = 6.dp))
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            listOf("all" to "全部时间", "today" to "今天", "week" to "本周", "month" to "本月", "quarter" to "近三月").forEach { (id, label) ->
                Text(label, color = if (state.time == id) Ink.accent else Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { model.time(id) }.padding(bottom = 8.dp))
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            listOf("" to "全部画面", "photo" to "真人", "anime" to "动漫").forEach { (id, label) ->
                Text(label, color = if (state.look == id) Ink.accent else Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { model.look(id) }.padding(bottom = 8.dp))
            }
        }
        if (state.query.isNotBlank()) {
            val authors = state.cards.filter { card ->
                card.authorId.isNotBlank() && (card.author.contains(state.query, ignoreCase = true) || card.authorId.contains(state.query, ignoreCase = true))
            }.distinctBy { it.authorId }
            if (authors.isNotEmpty()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                    Text("作者", color = Ink.muted, fontSize = 12.sp)
                    authors.forEach { card ->
                        Text(card.author, color = Ink.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { model.openAuthor(card.authorId, card.author) }.padding(vertical = 4.dp))
                    }
                }
            }
        }
        if (state.query.isNotBlank() && state.topics.isNotEmpty()) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                Text("主题", color = Ink.muted, fontSize = 12.sp)
                state.topics.forEach { topic ->
                    Text(
                        topic.title,
                        color = Ink.text,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { onTopic(topic.id) }.padding(vertical = 4.dp),
                    )
                }
            }
        }
        Box(Modifier.fillMaxSize()) {
            when {
                state.cards.isEmpty() && state.loading -> CenterMessage("正在读取广场")
                state.cards.isEmpty() && state.error != null -> Column(
                    Modifier.fillMaxSize().padding(28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(state.error ?: "", color = Ink.muted, fontSize = 16.sp)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "重新加载",
                        color = Ink.text,
                        fontSize = 15.sp,
                        modifier = Modifier.clickable { model.refresh() }.padding(8.dp),
                    )
                }
                else -> PullToRefreshBox(
                    isRefreshing = state.refreshing,
                    onRefresh = { model.refresh() },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    val grid = rememberLazyGridState()
                    LaunchedEffect(grid, state.cards.size, state.hasMore) {
                        snapshotFlow { grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
                            .distinctUntilChanged()
                            .collect { last ->
                                if (last >= state.cards.size - 6) model.loadMore()
                            }
                    }
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(if (state.single) 1 else 2),
                        state = grid,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 28.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        if (state.cards.isEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                val empty = when {
                                    state.category == "favorites" && state.favorites.isEmpty() -> "还没有收藏"
                                    state.category == "following" && state.followed.isEmpty() -> "还没有关注的作者"
                                    else -> "没有符合的角色"
                                }
                                Text(empty, color = Ink.muted, modifier = Modifier.padding(vertical = 28.dp))
                            }
                        }
                        items(state.cards, key = { it.id }) { card ->
                            Column(Modifier.clickable { model.openDetail(card.id) }) {
                                RemoteImage(
                                    origin = model.origin,
                                    url = card.cover,
                                    contentDescription = card.name,
                                    modifier = Modifier.fillMaxWidth().aspectRatio(0.72f),
                                )
                                Spacer(Modifier.height(8.dp))
                                Text(
                                    card.name,
                                    color = Ink.text,
                                    fontSize = 14.sp,
                                    lineHeight = 18.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                val like = state.likes[card.id]
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Text(
                                        if (card.id in state.favorites) "已收藏" else "收藏",
                                        color = if (card.id in state.favorites) Ink.accent else Ink.muted,
                                        fontSize = 12.sp,
                                        modifier = Modifier.clickable { model.toggleFavorite(card.id) }.padding(top = 4.dp),
                                    )
                                    Text(
                                        if (like?.liked == true) "已喜欢 ${like.count}" else "喜欢 ${like?.count ?: ""}".trim(),
                                        color = if (like?.liked == true) Ink.accent else Ink.muted,
                                        fontSize = 12.sp,
                                        modifier = Modifier.clickable { model.toggleLike(card.id) }.padding(top = 4.dp),
                                    )
                                }
                                if (card.author.isNotBlank()) {
                                    Text(
                                        card.author,
                                        color = if (card.authorId.isBlank()) Ink.muted else Ink.text,
                                        fontSize = 12.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.padding(top = 4.dp).then(
                                            if (card.authorId.isBlank()) Modifier else Modifier.clickable { model.openAuthor(card.authorId, card.author) },
                                        ),
                                    )
                                }
                                val meta = listOfNotNull(
                                    card.heat.takeIf { it.isNotBlank() }?.let { "热度 $it" },
                                ).joinToString(" · ")
                                if (meta.isNotBlank()) {
                                    Spacer(Modifier.height(3.dp))
                                    Text(meta, color = Ink.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                        if (state.loadingMore || state.moreError != null) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                                    if (state.moreError != null) {
                                        Text(
                                            "下一页没有载入，点此重试",
                                            color = Ink.muted,
                                            fontSize = 13.sp,
                                            modifier = Modifier.clickable { model.retryMore() }.padding(8.dp),
                                        )
                                    } else {
                                        Text("正在加载", color = Ink.muted, fontSize = 13.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CharacterDetail(
    origin: String,
    state: FeedUi,
    card: top.xumeng.app.core.network.PublicCard?,
    close: () -> Unit,
    favorite: (String) -> Unit,
    like: (String) -> Unit,
        open: (CatalogCard, Int, Boolean) -> Unit,
        follow: (String) -> Unit,
        author: (String, String) -> Unit,
        share: (String, (String) -> Unit) -> Unit,
) {
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    var copied by remember(card?.id) { mutableStateOf(false) }
    var opening by remember(card?.id) { mutableIntStateOf(0) }
    var touched by remember(card?.id) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Ink.background).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp)) {
        Text("返回", color = Ink.muted, modifier = Modifier.clickable(onClick = close).padding(bottom = 8.dp))
        if (card == null) {
            Text(state.detailError ?: "正在读取角色", color = Ink.muted, modifier = Modifier.padding(top = 24.dp))
            return
        }
        val face = card.cover.ifBlank { card.gallery.firstOrNull { it.isNotBlank() }.orEmpty() }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.Top) {
            if (face.isNotBlank()) {
                RemoteImage(origin, face, card.name, Modifier.padding(end = 12.dp).width(56.dp).height(56.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(card.name, color = Ink.text, fontSize = 22.sp, lineHeight = 30.sp)
                if (card.author.isNotBlank()) {
                    Text(
                        card.author,
                        color = if (card.authorId.isBlank()) Ink.muted else Ink.text,
                        fontSize = 18.sp,
                        lineHeight = 26.sp,
                        modifier = Modifier.padding(top = 4.dp).then(if (card.authorId.isBlank()) Modifier else Modifier.clickable { author(card.authorId, card.author) }),
                    )
                }
            }
        }
        val saved = card.id in state.favorites
        val mark = state.likes[card.id]
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
            DetailMark("heart", if (mark?.liked == true) "取消赞" else "赞", mark?.liked == true, mark?.count?.toString()) { like(card.id) }
            DetailMark("book", if (saved) "取消收藏" else "收藏", saved, null) { favorite(card.id) }
            DetailMark(if (copied) "check" else "copy", if (copied) "链接已复制" else "复制链接", copied, if (copied) "已复制" else null) {
                share(card.id) { url ->
                    clipboard.setText(androidx.compose.ui.text.AnnotatedString(url))
                    copied = true
                }
            }
            if (card.authorId.isNotBlank()) {
                val following = card.authorId in state.followed
                DetailMark(if (following) "check" else "plus", if (following) "已关注" else "关注", following, null) { follow(card.authorId) }
            }
        }
        if (card.tags.isNotEmpty()) {
            Text(card.tags.joinToString(" · "), color = Ink.muted, fontSize = 15.sp, lineHeight = 22.sp, modifier = Modifier.padding(top = 8.dp))
        }
        val intro = card.introduction.ifBlank { card.description }
        if (intro.isNotBlank()) Block("简介", intro)
        if (card.description.isNotBlank() && card.introduction.isNotBlank() && card.description != card.introduction) Block("介绍", card.description)
        if (card.scenario.isNotBlank()) Block("场景", card.scenario)
        if (card.personality.isNotBlank()) Block("性格", card.personality)
        if (card.appearance.isNotBlank()) Block("外貌", card.appearance)
        if (card.notes.isNotBlank()) Block("作者备注", card.notes)
        if (card.interactionSettings.isNotBlank()) Block("互动设置", card.interactionSettings)
        val extras = card.gallery.filter { it.isNotBlank() && it != face }
        if (extras.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                extras.forEach { url ->
                    RemoteImage(origin, url, card.name, Modifier.width(108.dp).height(144.dp))
                }
            }
        }
        val choices = openingChoices(card)
        val selected = choices.firstOrNull { it.first == opening }?.first ?: choices.firstOrNull()?.first ?: 0
        if (choices.size > 1) {
            Text("选择开场", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 16.dp))
            choices.forEach { (index, label) ->
                Text(label, color = if (selected == index) Ink.accent else Ink.text, modifier = Modifier.clickable { opening = index; touched = true }.padding(vertical = 4.dp))
            }
        }
        val preview = openingText(card, selected)
        if (preview.isNotBlank()) Block("开场", preview)
        val target = CatalogCard(card.id, card.name, card.author, "", card.cover)
        Text("开始聊天", color = Ink.text, fontSize = 16.sp, modifier = Modifier.clickable { open(target, selected, touched) }.padding(top = 18.dp))
        if (choices.size > 1) Text("用此开场新建聊天", color = Ink.accent, modifier = Modifier.clickable { open(target, selected, true) }.padding(vertical = 10.dp))
    }
}

private fun openingChoices(card: top.xumeng.app.core.network.PublicCard): List<Pair<Int, String>> {
    val primary = card.openings.joinToString("\n") { it.content }.ifBlank { card.firstMessage }
    return buildList {
        if (primary.isNotBlank()) add(0 to openingLabel(primary, "开场 1"))
        card.greetings.forEachIndexed { index, greeting -> add((index + 1) to openingLabel(greeting, "开场 ${index + 2}")) }
    }
}

private fun openingText(card: top.xumeng.app.core.network.PublicCard, index: Int): String {
    if (index <= 0) return card.openings.joinToString("\n\n") { it.content }.ifBlank { card.firstMessage }
    return card.greetings.getOrNull(index - 1).orEmpty()
}

private fun openingLabel(text: String, fallback: String): String {
    val line = text.lineSequence().firstOrNull()?.trim().orEmpty()
    return if (line.isNotEmpty() && line.length <= 40 && !line.contains('<') && !line.contains('>')) line else fallback
}

@Composable
private fun DetailMark(icon: String, label: String, active: Boolean, count: String?, onClick: () -> Unit) {
    Row(
        Modifier.semantics(mergeDescendants = true) { contentDescription = label }.clickable(onClick = onClick).padding(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Mark(icon, size = 16.dp, color = if (active) Ink.accent else Ink.muted)
        if (!count.isNullOrBlank()) Text(count, color = if (active) Ink.accent else Ink.muted, fontSize = 13.sp)
    }
}

@Composable
private fun Block(title: String, body: String) {
    Text(title, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 16.dp))
    Text(body, color = Ink.text, fontSize = 18.sp, lineHeight = 28.sp, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun CenterMessage(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = Ink.muted, fontSize = 16.sp)
    }
}
