package top.xumeng.app.feature.feed

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.LikeMark
import top.xumeng.app.core.network.PublicCard
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.core.network.XumengHttp
import java.net.URLEncoder
import java.time.ZoneId
import java.time.Instant

data class FeedUi(
    val cards: List<CatalogCard> = emptyList(),
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val refreshing: Boolean = false,
    val hasMore: Boolean = false,
    val error: String? = null,
    val moreError: String? = null,
    val query: String = "",
    val category: String = "",
    val sort: String = "hot",
    val time: String = "all",
    val look: String = "",
    val shelfAuthor: String = "",
    val shelfAuthorName: String = "",
    val favorites: List<String> = emptyList(),
    val likes: Map<String, LikeMark> = emptyMap(),
    val detail: PublicCard? = null,
    val detailError: String? = null,
    val openingDetail: Boolean = false,
    val followed: List<String> = emptyList(),
    val blocked: List<String> = emptyList(),
    val topics: List<FeedTopic> = emptyList(),
    val single: Boolean = false,
)

data class FeedTopic(val id: String, val title: String, val author: String)

private val authorId = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$")
private val shareId = Regex("^[a-z0-9][a-z0-9-]{0,119}$")

private fun characterShareUrl(origin: String, id: String, invite: String?): String {
    val code = invite?.trim().orEmpty()
    val query = if (code.isEmpty()) "" else "?invite=${URLEncoder.encode(code, "UTF-8")}&from=character"
    if (shareId.matches(id)) return "$origin/c/$id$query"
    val hash = "#character/${URLEncoder.encode(id, "UTF-8")}"
    return if (query.isEmpty()) "$origin/$hash" else "$origin/$query$hash"
}

private data class ShelfLoad(
    val blocked: List<String>,
    val page: CatalogPage,
    val authors: List<String>,
    val topics: List<FeedTopic>,
    val single: Boolean,
)

class FeedViewModel(app: Application) : AndroidViewModel(app) {
    val origin: String = BuildConfig.WEB_ORIGIN
    private val backend = XumengApi.get(origin)
    private val stateFlow = MutableStateFlow(FeedUi())
    private var savedIds: List<String> = emptyList()
    val state: StateFlow<FeedUi> = stateFlow.asStateFlow()
    private var offset = 0
    private var generation = 0
    private var skippedBlockedPages = 0
    private var replaceOnNext = false

    init {
        refresh()
        reloadFavorites()
    }

    private fun reloadFavorites() {
        viewModelScope.launch {
            val ids = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.favoriteIds() } }.getOrDefault(emptyList())
            savedIds = ids
            stateFlow.update { it.copy(favorites = ids) }
        }
    }

    fun refresh() = load(reset = true)

    fun syncLayout() {
        viewModelScope.launch {
            val single = runCatching { withContext(Dispatchers.IO) { backend.ensureSession().homeLayout == "single" } }.getOrDefault(stateFlow.value.single)
            stateFlow.update { it.copy(single = single) }
        }
    }

    fun search(query: String) {
        stateFlow.update { it.copy(query = query.trim().take(40), shelfAuthor = "", shelfAuthorName = "", cards = emptyList()) }
        load(reset = true)
    }

    fun category(name: String) {
        stateFlow.update { it.copy(category = name, shelfAuthor = "", shelfAuthorName = "", cards = emptyList()) }
        if (name == "favorites") {
            viewModelScope.launch {
                val ids = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.favoriteIds() } }.getOrDefault(savedIds)
                savedIds = ids
                stateFlow.update { it.copy(favorites = ids) }
                load(reset = true)
            }
        } else {
            load(reset = true)
        }
    }

    fun toggleFavorite(id: String) {
        viewModelScope.launch {
            val turnOn = id !in savedIds
            val changed = runCatching {
                withContext(Dispatchers.IO) {
                    val session = backend.ensureSession()
                    backend.setFavorite(id, turnOn, session.version, session.user.id)
                    backend.favoriteIds()
                }
            }
            changed.onSuccess { ids ->
                savedIds = ids
                stateFlow.update { current ->
                    val cards = if (current.category == "favorites" && !turnOn) current.cards.filterNot { it.id == id } else current.cards
                    current.copy(favorites = ids, cards = cards)
                }
            }
        }
    }

    fun sort(sort: String) {
        if (sort != "hot" && sort != "new" && sort != "likes") return
        stateFlow.update { it.copy(sort = sort, cards = emptyList()) }
        load(reset = true)
    }

    fun time(time: String) {
        if (time != "today" && time != "week" && time != "month" && time != "quarter" && time != "all") return
        stateFlow.update { it.copy(time = time, cards = emptyList()) }
        load(reset = true)
    }

    fun look(look: String) {
        if (look.isNotEmpty() && look != "photo" && look != "anime") return
        stateFlow.update { it.copy(look = look, cards = emptyList()) }
        load(reset = true)
    }

    fun openAuthor(id: String, name: String) {
        if (!authorId.matches(id)) return
        stateFlow.update {
            it.copy(
                shelfAuthor = id,
                shelfAuthorName = name.ifBlank { "作者" },
                category = "",
                query = "",
                detail = null,
                openingDetail = false,
                detailError = null,
                cards = emptyList(),
            )
        }
        load(reset = true)
        viewModelScope.launch {
            val ids = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.followedAuthors() } }.getOrDefault(emptyList())
            stateFlow.update { it.copy(followed = ids) }
        }
    }

    fun shareCharacter(id: String, onReady: (String) -> Unit) {
        if (id.isBlank()) return
        viewModelScope.launch {
            val code = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.referral().code } }.getOrNull()
            onReady(characterShareUrl(origin, id, code))
        }
    }

    fun closeAuthor() {
        if (stateFlow.value.shelfAuthor.isBlank()) return
        stateFlow.update { it.copy(shelfAuthor = "", shelfAuthorName = "", cards = emptyList()) }
        load(reset = true)
    }

    fun loadMore() {
        val current = stateFlow.value
        if (current.loading || current.loadingMore || current.refreshing || !current.hasMore || current.moreError != null) return
        load(reset = false)
    }

    fun retryMore() {
        stateFlow.update { it.copy(moreError = null) }
        loadMore()
    }

    fun openDetail(id: String) {
        viewModelScope.launch {
            stateFlow.update { it.copy(openingDetail = true, detail = null, detailError = null) }
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    backend.ensureSession()
                    backend.catalogCard(id) to backend.followedAuthors()
                }
            }
            loaded.fold(
                onSuccess = { (card, followed) ->
                    stateFlow.update { it.copy(openingDetail = false, detail = card, followed = followed, detailError = null) }
                    loadLikes(listOf(card.id))
                },
                onFailure = { error -> stateFlow.update { it.copy(openingDetail = false, detailError = error.message ?: "角色详情没有打开") } },
            )
        }
    }

    fun closeDetail() { stateFlow.update { it.copy(openingDetail = false, detail = null, detailError = null) } }

    fun toggleFollow(authorId: String) {
        if (authorId.isBlank()) return
        val follow = authorId !in stateFlow.value.followed
        viewModelScope.launch {
            val done = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.setFollow(authorId, follow); backend.followedAuthors() } }
            done.fold(
                onSuccess = { ids -> stateFlow.update { it.copy(followed = ids, detailError = null) } },
                onFailure = { error -> stateFlow.update { it.copy(detailError = error.message ?: "关注没有保存") } },
            )
        }
    }

    fun toggleLike(id: String) {
        val liked = stateFlow.value.likes[id]?.liked == true
        viewModelScope.launch {
            val next = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.setLike(id, !liked) } }
            next.onSuccess { mark -> stateFlow.update { it.copy(likes = it.likes + (id to mark)) } }
        }
    }

    private fun discoveryCutoff(time: String, now: Long = System.currentTimeMillis()): Long? {
        if (time == "all" || time.isBlank()) return null
        val zone = ZoneId.of("Asia/Shanghai")
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val start = when (time) {
            "today" -> today
            "week" -> today.minusDays(((today.dayOfWeek.value + 6) % 7).toLong())
            "month" -> today.withDayOfMonth(1)
            "quarter" -> today.withDayOfMonth(1).minusMonths(2)
            else -> return null
        }
        return start.atStartOfDay(zone).toInstant().toEpochMilli()
    }

    private fun loadLikes(ids: List<String>) {
        val missing = ids.filter { it !in stateFlow.value.likes }
        if (missing.isEmpty()) return
        viewModelScope.launch {
            val stats = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.likeStats(missing) } }.getOrDefault(emptyMap())
            if (stats.isEmpty()) return@launch
            stateFlow.update { it.copy(likes = it.likes + stats) }
        }
    }

    private fun load(reset: Boolean) {
        if (reset) {
            skippedBlockedPages = 0
            replaceOnNext = true
        }
        val token = ++generation
        val start = if (reset) 0 else offset
        stateFlow.update {
            it.copy(
                loading = reset && it.cards.isEmpty(),
                refreshing = reset && it.cards.isNotEmpty(),
                loadingMore = !reset,
                error = if (reset) null else it.error,
                moreError = if (reset) null else it.moreError,
            )
        }
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val filters = stateFlow.value
                    val favorites = filters.category == "favorites" && filters.shelfAuthor.isBlank()
                    val shelfAuthor = filters.shelfAuthor.takeIf { authorId.matches(it) }.orEmpty()
                    val following = filters.category == "following" && shelfAuthor.isEmpty()
                    val authors = if (following) {
                        runCatching { backend.ensureSession(); backend.followedAuthors() }.getOrDefault(emptyList())
                            .filter { authorId.matches(it) }.distinct().take(20)
                    } else {
                        emptyList()
                    }
                    val slice = if (favorites) savedIds.drop(start).take(24) else emptyList()
                    val query = URLEncoder.encode(filters.query, "UTF-8")
                    val tag = URLEncoder.encode(filters.category, "UTF-8")
                    val sort = if (following || shelfAuthor.isNotEmpty()) "new" else filters.sort
                    val url = buildString {
                        append("$origin/api/backend/v1/publishing/catalog?limit=24&offset=${if (favorites) 0 else start}&view=card&sort=$sort")
                        if (!favorites && !following && shelfAuthor.isEmpty() && filters.query.isNotBlank()) append("&q=$query")
                        if (!favorites && !following && shelfAuthor.isEmpty() && filters.category.isNotBlank()) append("&tags=$tag")
                        if (favorites && slice.isNotEmpty()) append("&ids=").append(slice.joinToString(",") { URLEncoder.encode(it, "UTF-8") })
                        if (shelfAuthor.isNotEmpty()) append("&authors=").append(URLEncoder.encode(shelfAuthor, "UTF-8"))
                        else if (following && authors.isNotEmpty()) append("&authors=").append(authors.joinToString(",") { URLEncoder.encode(it, "UTF-8") })
                        discoveryCutoff(filters.time)?.let { append("&since=$it") }
                        if (filters.look == "photo" || filters.look == "anime") append("&look=${filters.look}")
                    }
                    val blocked = runCatching { backend.ensureSession(); backend.blockedTags() }.getOrDefault(emptyList())
                    val page = if ((favorites && slice.isEmpty()) || (following && authors.isEmpty())) {
                        CatalogPage(emptyList(), 0, start, 24, false)
                    } else {
                        val parsed = CatalogJson.parse(XumengHttp.getText(origin, url, 2 * 1024 * 1024), origin)
                        if (favorites) parsed.copy(offset = start, limit = 24, hasMore = start + slice.size < savedIds.size) else parsed
                    }
                    val topics = if (filters.query.isNotBlank() && !favorites && !following && shelfAuthor.isEmpty()) {
                        runCatching {
                            backend.ensureSession()
                            backend.forumPosts(q = filters.query).posts.take(8).map { FeedTopic(it.id, it.title, it.author) }
                        }.getOrDefault(emptyList())
                    } else {
                        emptyList()
                    }
                    val single = runCatching { backend.ensureSession().homeLayout == "single" }.getOrDefault(false)
                    ShelfLoad(blocked, page, authors, topics, single)
                }
            }
            if (token != generation) return@launch
            result.fold(
                onSuccess = { loaded ->
                    val blocked = loaded.blocked
                    val page = loaded.page
                    val authors = loaded.authors
                    val blockedKeys = blocked.map { it.lowercase() }.toSet()
                    val visible = page.cards.filter { card -> card.tags.none { it.lowercase() in blockedKeys } }
                    offset = page.offset + page.limit
                    if (visible.isEmpty() && page.hasMore && skippedBlockedPages < 8) {
                        skippedBlockedPages++
                        load(reset = false)
                        return@launch
                    }
                    skippedBlockedPages = 0
                    val replace = replaceOnNext
                    replaceOnNext = false
                    stateFlow.update { current ->
                        val merged = if (replace) {
                            visible
                        } else {
                            val seen = current.cards.map { it.id }.toMutableSet()
                            current.cards + visible.filter { seen.add(it.id) }
                        }
                        current.copy(
                            cards = merged,
                            blocked = blocked,
                            followed = if (current.category == "following") authors else current.followed,
                            topics = if (replace) loaded.topics else current.topics,
                            single = loaded.single,
                            loading = false,
                            loadingMore = false,
                            refreshing = false,
                            hasMore = page.hasMore,
                            error = null,
                            moreError = null,
                        )
                    }
                    loadLikes(page.cards.map { it.id })
                },
                onFailure = {
                    stateFlow.update { current ->
                        if (reset && current.cards.isEmpty()) {
                            current.copy(loading = false, refreshing = false, loadingMore = false, error = "广场暂时读不出来。")
                        } else {
                            current.copy(loading = false, refreshing = false, loadingMore = false, moreError = "下一页没有载入。")
                        }
                    }
                },
            )
        }
    }
}
