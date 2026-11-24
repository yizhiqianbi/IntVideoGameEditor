package top.xumeng.app.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Call
import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.AccountRecord
import top.xumeng.app.core.network.ChatMediaAsset
import top.xumeng.app.core.network.ChatMediaPending
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.core.network.Line
import java.io.File
import java.security.MessageDigest
import top.xumeng.app.core.network.ReplyOption
import top.xumeng.app.core.network.SavedPersona
import top.xumeng.app.core.network.StoryCharacter
import top.xumeng.app.core.network.Talk
import java.util.UUID

data class ThreadUi(
    val id: String,
    val characterId: String,
    val title: String,
    val lines: List<Line>,
    val clock: String = "story",
    val memory: String = "",
    val world: String = "",
    val opening: String = "",
)

data class ChatUi(
    val loading: Boolean = true,
    val sending: Boolean = false,
    val talks: List<Talk> = emptyList(),
    val thread: ThreadUi? = null,
    val draftReply: String = "",
    val error: String? = null,
    val accountLabel: String = "",
    val suggesting: Boolean = false,
    val suggestions: List<ReplyOption> = emptyList(),
    val quickReplies: List<String> = emptyList(),
    val chrome: PlayChrome = PlayChrome(),
    val notice: String? = null,
    val importing: Boolean = false,
    val personas: List<SavedPersona> = emptyList(),
    val defaultPersona: String = "",
    val personaChoice: String = "",
    val composer: String? = null,
    val chatFontSize: String = "medium",
    val chatFont: String = "system",
    val userBubble: String = "",
    val assistantBubble: String = "",
    val bubbleOpacity: Int = 80,
    val chatBackground: String = "cover",
    val cover: String = "",
    val enterKey: String = "auto",
    val media: List<ChatMediaAsset> = emptyList(),
    val mediaPending: List<ChatMediaPending> = emptyList(),
    val mediaBusy: String = "",
    val audioMessageId: String = "",
    val audioPath: String = "",
    val imageMessageId: String = "",
    val imagePath: String = "",
)

private class StopReply : Exception()

class ChatViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private var savingMemory = false
    private var savingEdit = false
    private var stopRequested = false
    private var activeCall: Call? = null
    private val characters = mutableMapOf<String, StoryCharacter>()
    private var account: AccountRecord? = null
    private var editIndex: Int? = null
    private val mutable = MutableStateFlow(ChatUi())
    val state: StateFlow<ChatUi> = mutable.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            mutable.update { it.copy(loading = true, error = null) }
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.ensureSession() } }
            loaded.fold(
                onSuccess = { record ->
                    account = record
                    mutable.update { it.copy(loading = false, talks = record.talks, accountLabel = record.user.nickname, error = null, personas = record.personas, defaultPersona = record.persona, personaChoice = record.conversationPersonas[it.thread?.id].orEmpty()) }
                },
                onFailure = { error -> mutable.update { it.copy(loading = false, error = error.message ?: "账号没有连上") } },
            )
        }
    }

    fun openTalk(id: String) {
        val ready = mutable.value.talks.find { it.id == id }
        if (ready != null) {
            showTalk(ready)
            return
        }
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.ensureSession() } }.getOrNull() ?: return@launch
            account = loaded
            val talk = loaded.talks.find { it.id == id }
            mutable.update { it.copy(loading = false, talks = loaded.talks, accountLabel = loaded.user.nickname) }
            if (talk != null) showTalk(talk)
        }
    }

    private fun showTalk(talk: Talk) {
        val current = account
        mutable.update {
            it.copy(
                thread = threadOf(talk),
                draftReply = "",
                suggestions = emptyList(),
                quickReplies = emptyList(),
                chrome = PlayChrome(),
                cover = "",
                error = null,
                personas = current?.personas.orEmpty(),
                defaultPersona = current?.persona.orEmpty(),
                personaChoice = current?.conversationPersonas[talk.id].orEmpty(),
                media = emptyList(),
                mediaPending = emptyList(),
                mediaBusy = "",
                audioMessageId = "",
                audioPath = "",
                imageMessageId = "",
                imagePath = "",
            )
        }
        loadChrome(talk.characterId)
        loadMedia(talk.id)
    }

    fun openCharacter(id: String, name: String, opening: Int = 0, fresh: Boolean = false) {
        viewModelScope.launch {
            if (account == null) {
                val loaded = runCatching { withContext(Dispatchers.IO) { backend.ensureSession() } }.getOrElse { error ->
                    mutable.update { it.copy(error = error.message ?: "账号没有连上") }
                    return@launch
                }
                account = loaded
                mutable.update { it.copy(talks = loaded.talks, accountLabel = loaded.user.nickname, loading = false) }
            }
            val existing = if (fresh) null else mutable.value.talks.filter { it.characterId == id }.maxByOrNull { it.updatedAt }
            if (existing != null) {
                openTalk(existing.id)
                return@launch
            }
            val current = account ?: return@launch
            mutable.update { it.copy(sending = true, error = null) }
            val created = runCatching {
                withContext(Dispatchers.IO) {
                    val snapshot = if (opening > 0) {
                        val character = characters.getOrPut(id) { backend.character(id) }
                        openingSnapshot(character, opening)
                    } else {
                        null
                    }
                    backend.createConversation(id, current.version, current.user.id, snapshot)
                }
            }
            created.fold(
                onSuccess = { record ->
                    account = record
                    val talk = record.talks.filter { it.characterId == id }.maxByOrNull { it.updatedAt }
                    mutable.update {
                        it.copy(
                            sending = false,
                            talks = record.talks,
                            thread = talk?.let { item -> threadOf(item, name) },
                            error = if (talk == null) "会话没有写进账号" else null,
                        )
                    }
                    if (talk != null) loadChrome(talk.characterId)
                },
                onFailure = { error -> mutable.update { it.copy(sending = false, error = error.message ?: "没有打开这个角色") } },
            )
        }
    }

    fun syncDisplay() {
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.ensureSession() } }.getOrNull() ?: return@launch
            account = loaded
            mutable.update { it.copy(chatFontSize = loaded.chatFontSize, chatFont = loaded.chatFont, userBubble = loaded.userBubble, assistantBubble = loaded.assistantBubble, bubbleOpacity = loaded.bubbleOpacity, chatBackground = loaded.chatBackground, enterKey = loaded.enterKey) }
        }
    }

    fun stop() {
        if (!mutable.value.sending) return
        stopRequested = true
        activeCall?.cancel()
    }

    fun consumeComposer() {
        if (mutable.value.composer != null) mutable.update { it.copy(composer = null) }
    }

    fun closeThread() {
        editIndex = null
        mutable.update { it.copy(thread = null, draftReply = "", suggestions = emptyList(), suggesting = false, quickReplies = emptyList(), chrome = PlayChrome(), error = null, media = emptyList(), mediaPending = emptyList(), mediaBusy = "", audioMessageId = "", audioPath = "", imageMessageId = "", imagePath = "") }
    }

    fun prepareEdit(): String? {
        val lines = mutable.value.thread?.lines ?: return null
        val index = lines.indexOfLast { it.role == "user" }
        if (index < 0 || mutable.value.sending) return null
        editIndex = index
        return lines[index].text
    }

    fun suggest() {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending || mutable.value.suggesting || thread.lines.lastOrNull()?.role != "assistant") return
        viewModelScope.launch {
            mutable.update { it.copy(suggesting = true, suggestions = emptyList(), error = null) }
            val loaded = runCatching {
                val character = withContext(Dispatchers.IO) { characters.getOrPut(thread.characterId) { backend.character(thread.characterId) } }
                withContext(Dispatchers.IO) {
                    backend.suggestions(character, thread.lines, current.model, current.user.nickname, current.preset, activePersona(thread.id, current))
                }
            }
            loaded.fold(
                onSuccess = { options -> mutable.update { it.copy(suggesting = false, suggestions = options) } },
                onFailure = { error -> mutable.update { it.copy(suggesting = false, error = error.message ?: "行动建议生成失败") } },
            )
        }
    }

    fun backFromThread(): Boolean {
        if (mutable.value.thread == null) return false
        closeThread()
        return true
    }

    fun send(text: String) {
        val clean = text.trim()
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (clean.isEmpty() || mutable.value.sending) return
        val editAt = editIndex
        editIndex = null
        val base = if (editAt != null && editAt < thread.lines.size && thread.lines[editAt].role == "user") thread.lines.take(editAt) else thread.lines
        val shown = base + Line(UUID.randomUUID().toString(), "user", clean)
        mutable.update { it.copy(sending = true, error = null, notice = null, draftReply = "", suggestions = emptyList(), thread = thread.copy(lines = shown)) }
        complete(thread, shown, thread.lines, current)
    }

    fun saveMessage(id: String, draft: String) {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending || savingEdit) return
        val index = thread.lines.indexOfFirst { it.id == id }
        if (index < 0) {
            mutable.update { it.copy(error = "这条消息已不存在，请重新打开消息菜单。", notice = null) }
            return
        }
        if (draft.length > 12_000) {
            mutable.update { it.copy(error = "消息不能超过 12,000 字符。", notice = null) }
            return
        }
        if (draft.isBlank() || draft.contains('\u0000')) {
            mutable.update { it.copy(error = "消息不能为空。", notice = null) }
            return
        }
        val original = thread.lines[index].text
        val stored = PlayText.storedEdit(original, draft)
        if (stored == original) {
            mutable.update { it.copy(notice = "消息未改变。", error = null) }
            return
        }
        if (stored.isBlank() || stored.contains('\u0000') || stored.length > 12_000) {
            mutable.update { it.copy(error = "消息应为非空文本，且不超过 12000 字。", notice = null) }
            return
        }
        val lines = thread.lines.map { line -> if (line.id == id) line.copy(text = stored) else line }
        savingEdit = true
        viewModelScope.launch {
            val saved = runCatching {
                withContext(Dispatchers.IO) {
                    val messages = JSONArray()
                    lines.forEach { line -> messages.put(JSONObject().put("id", line.id).put("role", line.role).put("content", line.text)) }
                    backend.saveMessages(thread.id, messages, current.version, current.user.id)
                }
            }
            savingEdit = false
            saved.fold(
                onSuccess = { record ->
                    account = record
                    val talk = record.talks.find { it.id == thread.id }
                    mutable.update {
                        it.copy(
                            talks = record.talks,
                            thread = talk?.let { item -> threadOf(item) } ?: it.thread,
                            error = null,
                            notice = "消息已修改，后续聊天原文已保留。",
                        )
                    }
                    if (talk != null) loadChrome(talk.characterId)
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "消息没有保存", notice = null) } },
            )
        }
    }

    fun regenerateMessage(id: String) {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending || savingEdit) return
        val index = thread.lines.indexOfFirst { it.id == id }
        if (index < 0 || thread.lines[index].role != "assistant") return
        var userIndex = -1
        for (cursor in index - 1 downTo 0) {
            if (thread.lines[cursor].role == "user") {
                userIndex = cursor
                break
            }
        }
        if (userIndex < 0) return
        if (thread.lines.lastOrNull()?.id == id && thread.lines.getOrNull(index - 1)?.role == "user") {
            regenerate()
            return
        }
        val prefix = thread.lines.take(userIndex + 1)
        val known = mutable.value.talks.map { it.id }.toSet()
        val source = mutable.value.talks.find { it.id == thread.id }
        viewModelScope.launch {
            mutable.update { it.copy(sending = true, error = null, notice = null, draftReply = "") }
            val created = runCatching {
                withContext(Dispatchers.IO) {
                    val copied = prefix.map { line -> line.copy(id = UUID.randomUUID().toString()) }
                    val messages = JSONArray().apply {
                        copied.forEach { line -> put(JSONObject().put("id", line.id).put("role", line.role).put("content", line.text)) }
                    }
                    val opening = source?.opening?.takeIf { it.isNotBlank() }?.let { raw -> runCatching { JSONObject(raw) }.getOrNull() }
                    val branched = backend.branchConversation(
                        thread.characterId,
                        thread.title.take(100) + " · 重生成分支",
                        messages,
                        thread.clock,
                        reboundMemory(thread.memory, prefix, copied),
                        WorldJournal.rebind(thread.world, prefix, copied),
                        opening,
                        current.version,
                        current.user.id,
                    )
                    val createdId = branched.talks.firstOrNull { it.id !in known }?.id
                    if (createdId == null) branched else carryPersona(branched, thread.id, createdId)
                }
            }
            created.fold(
                onSuccess = { record ->
                    account = record
                    val talk = record.talks.firstOrNull { it.id !in known }
                    if (talk == null) {
                        mutable.update { it.copy(sending = false, talks = record.talks, error = "分支没有写进账号") }
                        return@fold
                    }
                    val next = threadOf(talk)
                    mutable.update {
                        it.copy(
                            talks = record.talks,
                            thread = next,
                            personas = record.personas,
                            defaultPersona = record.persona,
                            personaChoice = record.conversationPersonas[talk.id].orEmpty(),
                            notice = "已建立分支重新生成，原会话完整保留。",
                        )
                    }
                    complete(next, next.lines, next.lines, record)
                },
                onFailure = { error -> mutable.update { it.copy(sending = false, error = error.message ?: "分支没有建立") } },
            )
        }
    }

    fun regenerate() {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending) return
        editIndex = null
        val lines = thread.lines
        if (lines.lastOrNull()?.role != "assistant" || lines.dropLast(1).lastOrNull()?.role != "user") return
        val shown = lines.dropLast(1)
        mutable.update { it.copy(sending = true, error = null, draftReply = "", suggestions = emptyList(), thread = thread.copy(lines = shown)) }
        complete(thread, shown, lines, current)
    }

    fun setClock(mode: String) {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending || thread.clock == mode) return
        viewModelScope.launch {
            val journal = WorldJournal.switchMode(thread.world, thread.lines, mode, System.currentTimeMillis())
            val saved = runCatching { withContext(Dispatchers.IO) { backend.setClock(thread.id, mode, journal, current.version, current.user.id) } }
            saved.fold(
                onSuccess = { record ->
                    account = record
                    val talk = record.talks.find { it.id == thread.id }
                    mutable.update { it.copy(talks = record.talks, thread = talk?.let { item -> threadOf(item) } ?: it.thread, error = null) }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "时间模式没有保存") } },
            )
        }
    }

    fun saveMemory(summary: String, scene: String, completed: String, pending: String, relationships: String, items: String, snapshot: String) {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending || savingMemory) return
        if (thread.memory != snapshot) {
            mutable.update { it.copy(error = "剧情记忆已更新，请关闭并重新打开后再修改。", notice = null) }
            return
        }
        val next = runCatching { StoryMemory.edited(thread.memory, thread.lines, summary, scene, completed, pending, relationships, items) }
        val memory = next.getOrElse { error ->
            mutable.update { it.copy(error = error.message ?: "内容过长或格式不正确。摘要最多2400字，场景最多1000字；列表每项最多400字，全部记录总量约6000字。", notice = null) }
            return
        }
        savingMemory = true
        viewModelScope.launch {
            val saved = runCatching { withContext(Dispatchers.IO) { backend.saveStoryMemory(thread.id, memory, current.version, current.user.id) } }
            savingMemory = false
            saved.fold(
                onSuccess = { record ->
                    account = record
                    val talk = record.talks.find { it.id == thread.id }
                    mutable.update { it.copy(talks = record.talks, thread = talk?.let { item -> threadOf(item) } ?: it.thread, error = null, notice = "剧情记忆已保存，下次对话会使用你的修正。") }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "剧情记忆没有保存", notice = null) } },
            )
        }
    }

    fun clearMemory(snapshot: String) {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending || savingMemory || StoryMemory.matched(thread.memory, thread.lines) == null) return
        if (thread.memory != snapshot) {
            mutable.update { it.copy(error = "剧情记忆已更新，请关闭并重新打开后再修改。", notice = null) }
            return
        }
        savingMemory = true
        viewModelScope.launch {
            val saved = runCatching { withContext(Dispatchers.IO) { backend.saveStoryMemory(thread.id, null, current.version, current.user.id) } }
            savingMemory = false
            saved.fold(
                onSuccess = { record ->
                    account = record
                    val talk = record.talks.find { it.id == thread.id }
                    mutable.update { it.copy(talks = record.talks, thread = talk?.let { item -> threadOf(item) } ?: it.thread, error = null, notice = "摘要已清除，原始对话仍保留。") }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "剧情记忆没有清除", notice = null) } },
            )
        }
    }

    fun rename(title: String) {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        val clean = title.trim()
        if (clean.isEmpty() || mutable.value.sending) return
        viewModelScope.launch {
            val saved = runCatching { withContext(Dispatchers.IO) { backend.renameConversation(thread.id, clean.take(80), current.version, current.user.id) } }
            saved.fold(
                onSuccess = { record ->
                    account = record
                    mutable.update { it.copy(talks = record.talks, thread = it.thread?.copy(title = clean.take(80)), error = null) }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "名称没有保存") } },
            )
        }
    }

    fun branch() {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        val talk = mutable.value.talks.find { it.id == thread.id }
        if (mutable.value.sending) return
        viewModelScope.launch {
            mutable.update { it.copy(sending = true, error = null, notice = null) }
            val saved = runCatching {
                withContext(Dispatchers.IO) {
                    val copied = thread.lines.map { line -> line.copy(id = UUID.randomUUID().toString()) }
                    val messages = JSONArray().apply {
                        copied.forEach { line -> put(JSONObject().put("id", line.id).put("role", line.role).put("content", line.text)) }
                    }
                    val opening = talk?.opening?.takeIf { it.isNotBlank() }?.let { raw -> runCatching { JSONObject(raw) }.getOrNull() }
                    val branched = backend.branchConversation(
                        thread.characterId,
                        thread.title.take(100) + " · 分支",
                        messages,
                        thread.clock,
                        reboundMemory(thread.memory, thread.lines, copied),
                        WorldJournal.rebind(thread.world, thread.lines, copied),
                        opening,
                        current.version,
                        current.user.id,
                    )
                    carryPersona(branched, thread.id, branched.talks.firstOrNull { it.id != thread.id }?.id)
                }
            }
            saved.fold(
                onSuccess = { record ->
                    account = record
                    val created = record.talks.firstOrNull { it.id != thread.id }
                    mutable.update {
                        it.copy(
                            sending = false,
                            talks = record.talks,
                            thread = created?.let { item -> threadOf(item) } ?: it.thread,
                            personas = record.personas,
                            defaultPersona = record.persona,
                            personaChoice = created?.let { item -> record.conversationPersonas[item.id].orEmpty() }.orEmpty(),
                            notice = "已复制当前会话，可从这里继续新的剧情。",
                            error = if (created == null) "分支没有写进账号" else null,
                        )
                    }
                },
                onFailure = { error -> mutable.update { it.copy(sending = false, error = error.message ?: "分支没有建立") } },
            )
        }
    }

    fun export(deliver: (String, String) -> Unit) {
        val thread = mutable.value.thread ?: return
        val talk = mutable.value.talks.find { it.id == thread.id }
        if (mutable.value.sending) return
        viewModelScope.launch {
            val built = runCatching {
                withContext(Dispatchers.IO) {
                    archive(backend.playableCard(thread.characterId), thread, talk?.opening.orEmpty())
                }
            }
            built.fold(
                onSuccess = { json ->
                    val name = "会话-${thread.title.ifBlank { "对话" }.take(40)}.json"
                    deliver(name, json)
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "会话存档导出失败，请重试。") } },
            )
        }
    }

    fun report(message: String) {
        mutable.update { it.copy(error = message) }
    }

    fun importArchive(raw: String) {
        if (mutable.value.sending || mutable.value.importing) return
        viewModelScope.launch {
            val current = account ?: runCatching { withContext(Dispatchers.IO) { backend.ensureSession() } }.getOrElse { error ->
                mutable.update { it.copy(error = error.message ?: "账号没有连上") }
                return@launch
            }
            account = current
            mutable.update { it.copy(importing = true, error = null, notice = null, talks = current.talks, accountLabel = current.user.nickname) }
            val saved = runCatching { withContext(Dispatchers.IO) { backend.importConversation(raw, current.version, current.user.id) } }
            saved.fold(
                onSuccess = { (record, unavailable) ->
                    account = record
                    val created = record.talks.firstOrNull()
                    mutable.update {
                        it.copy(
                            importing = false,
                            loading = false,
                            talks = record.talks,
                            thread = created?.let { item -> threadOf(item) } ?: it.thread,
                            notice = if (unavailable) "会话存档已导入；原角色不可用时可查看只读历史。" else "会话已导入。",
                            error = null,
                        )
                    }
                    if (created != null) loadChrome(created.characterId)
                },
                onFailure = { error -> mutable.update { it.copy(importing = false, error = error.message ?: "导入失败。") } },
            )
        }
    }

    fun loadPersonas() {
        if (mutable.value.sending) return
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.ensureSession() } }.getOrNull() ?: return@launch
            account = loaded
            mutable.update { it.copy(talks = loaded.talks, accountLabel = loaded.user.nickname, personas = loaded.personas, defaultPersona = loaded.persona, personaChoice = loaded.conversationPersonas[it.thread?.id].orEmpty()) }
        }
    }

    fun saveThreadPersona(choice: String, content: String, newName: String) {
        val thread = mutable.value.thread ?: return
        val current = account ?: return
        if (mutable.value.sending || savingMemory) return
        if (content.length > 4000 || content.contains('\u0000')) {
            mutable.update { it.copy(error = "我的人设不能超过 4000 个字符。", notice = null) }
            return
        }
        val personas = current.personas.toMutableList()
        val assigned = current.conversationPersonas.toMutableMap()
        val createdId = when (choice) {
            "default" -> {
                assigned.remove(thread.id)
                null
            }
            "new" -> {
                val title = newName.trim()
                if (title.isEmpty() || title.length > 80 || title.contains('\u0000')) {
                    mutable.update { it.copy(error = "请给新人设起一个 1 至 80 字的名称。", notice = null) }
                    return
                }
                if (personas.size >= 30) {
                    mutable.update { it.copy(error = "人设库最多保存 30 个人设，请先在我的预设里删除一个。", notice = null) }
                    return
                }
                if (assigned.size >= 500 && !assigned.containsKey(thread.id)) {
                    mutable.update { it.copy(error = "单独指定人设的对话已满，这个对话会继续使用默认人设。", notice = null) }
                    return
                }
                val id = UUID.randomUUID().toString()
                personas += SavedPersona(id, title, content)
                assigned[thread.id] = id
                id
            }
            else -> {
                val index = personas.indexOfFirst { it.id == choice }
                if (index < 0) {
                    mutable.update { it.copy(error = "请重新选择人设。", notice = null) }
                    return
                }
                personas[index] = personas[index].copy(content = content)
                assigned[thread.id] = choice
                null
            }
        }
        viewModelScope.launch {
            val saved = runCatching {
                withContext(Dispatchers.IO) {
                    val body = JSONObject().put("personas", personaArray(personas)).put("conversationPersonas", personaMap(assigned))
                    if (choice == "default") body.put("persona", content)
                    backend.savePreferences(current.version, current.user.id, body)
                }
            }
            saved.fold(
                onSuccess = { desk ->
                    account = current.copy(version = desk.version, persona = desk.persona, personas = desk.personas, conversationPersonas = desk.conversationPersonas)
                    mutable.update {
                        it.copy(
                            personas = desk.personas,
                            defaultPersona = desk.persona,
                            personaChoice = desk.conversationPersonas[thread.id].orEmpty(),
                            error = null,
                            notice = "设置已保存，下次回复会应用这些设置。",
                        )
                    }
                    if (createdId != null && desk.conversationPersonas[thread.id] != createdId) {
                        mutable.update { it.copy(error = "人设没有绑定到这个对话。") }
                    }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "人设没有保存", notice = null) } },
            )
        }
    }

    fun deleteTalk(id: String) {
        val current = account ?: return
        if (mutable.value.sending) return
        viewModelScope.launch {
            val removed = runCatching {
                withContext(Dispatchers.IO) {
                    val deleted = backend.deleteConversation(id, current.version, current.user.id)
                    if (!deleted.conversationPersonas.containsKey(id)) deleted
                    else runCatching {
                        val assigned = deleted.conversationPersonas.filterKeys { it != id }
                        val desk = backend.savePreferences(deleted.version, deleted.user.id, JSONObject().put("conversationPersonas", personaMap(assigned)))
                        deleted.copy(version = desk.version, persona = desk.persona, personas = desk.personas, conversationPersonas = desk.conversationPersonas)
                    }.getOrDefault(deleted)
                }
            }
            removed.fold(
                onSuccess = { record ->
                    account = record
                    mutable.update { it.copy(talks = record.talks, thread = if (it.thread?.id == id) null else it.thread, draftReply = "", error = null) }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "对话没有删除") } },
            )
        }
    }

    private fun complete(thread: ThreadUi, shown: List<Line>, rollback: List<Line>, current: AccountRecord) {
        viewModelScope.launch {
            val result = runCatching {
                val character = withContext(Dispatchers.IO) { characters.getOrPut(thread.characterId) { backend.character(thread.characterId) } }
                val reply = StringBuilder()
                var memoryRaw = thread.memory
                var version = current.version
                var worldEvent: JSONObject? = null
                withContext(Dispatchers.IO) {
                    val remembered = backend.remember(thread.id, memoryRaw, shown, current.model, version, current.user.id) { stopRequested }
                    remembered.first?.let { record ->
                        account = record
                        version = record.version
                    }
                    memoryRaw = remembered.second
                    if (stopRequested) throw StopReply()
                    try {
                        worldEvent = backend.reply(character, shown, current.model, current.maxTokens, current.user.nickname, current.preset, activePersona(thread.id, current), memoryOf(memoryRaw, shown), worldOf(thread.clock, thread.world), onCall = { activeCall = it }) { delta ->
                            reply.append(delta)
                            val draft = reply.toString()
                            mutable.update { state -> state.copy(draftReply = draft, chrome = PlayText.chrome(character, shown + Line("draft", "assistant", draft))) }
                        }
                    } catch (error: java.io.IOException) {
                        if (!stopRequested || reply.isBlank()) throw error
                    } finally {
                        activeCall = null
                    }
                }
                if (stopRequested && reply.isBlank()) throw StopReply()
                val assistant = Line(UUID.randomUUID().toString(), "assistant", reply.toString().trim())
                if (assistant.text.isEmpty()) throw IllegalStateException("这次没有收到回复")
                val saved = withContext(Dispatchers.IO) {
                    val messages = backend.saveMessages(thread.id, wire(shown + assistant), account?.version ?: version, current.user.id)
                    val journal = worldEvent?.let { WorldJournal.append(thread.world, shown + assistant, it, thread.clock) }
                    if (journal == null) messages else runCatching { backend.saveWorld(thread.id, journal, messages.version, current.user.id) }.getOrDefault(messages)
                }
                saved to assistant
            }
            result.fold(
                onSuccess = { (record, assistant) ->
                    stopRequested = false
                    account = record
                    mutable.update {
                        it.copy(
                            sending = false,
                            draftReply = "",
                            talks = record.talks,
                            thread = thread.copy(
                                lines = shown + assistant,
                                clock = record.talks.find { it.id == thread.id }?.clock ?: thread.clock,
                                memory = record.talks.find { it.id == thread.id }?.memory ?: thread.memory,
                                world = record.talks.find { it.id == thread.id }?.world ?: thread.world,
                            ),
                            chrome = PlayText.chrome(characters[thread.characterId], shown + assistant),
                            error = null,
                        )
                    }
                },
                onFailure = { error ->
                    stopRequested = false
                    activeCall = null
                    if (error is StopReply) {
                        val sent = if (shown.size == rollback.size + 1 && shown.lastOrNull()?.role == "user") shown.last().text else null
                        mutable.update { it.copy(sending = false, error = null, draftReply = "", thread = thread.copy(lines = rollback), composer = sent) }
                    } else {
                        mutable.update { it.copy(sending = false, error = error.message ?: "发送失败", thread = thread.copy(lines = rollback), draftReply = "") }
                    }
                },
            )
        }
    }

    private fun activePersona(conversationId: String, current: AccountRecord): String {
        val id = current.conversationPersonas[conversationId]
        return current.personas.firstOrNull { it.id == id }?.content ?: current.persona
    }

    private fun carryPersona(record: AccountRecord, fromId: String, toId: String?): AccountRecord {
        val createdId = toId ?: return record
        val personaId = record.conversationPersonas[fromId] ?: return record
        if (record.conversationPersonas[createdId] == personaId) return record
        if (!record.conversationPersonas.containsKey(createdId) && record.conversationPersonas.size >= 500) return record
        return runCatching {
            val assigned = record.conversationPersonas + (createdId to personaId)
            val desk = backend.savePreferences(record.version, record.user.id, JSONObject().put("conversationPersonas", personaMap(assigned)))
            record.copy(version = desk.version, persona = desk.persona, personas = desk.personas, conversationPersonas = desk.conversationPersonas)
        }.getOrDefault(record)
    }

    private fun personaArray(personas: List<SavedPersona>): JSONArray = JSONArray().apply {
        personas.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("content", it.content)) }
    }

    private fun personaMap(assigned: Map<String, String>): JSONObject = JSONObject().apply {
        assigned.forEach { (key, value) -> put(key, value) }
    }

    fun reloadMedia() {
        val id = mutable.value.thread?.id ?: return
        loadMedia(id)
    }

    fun generateMedia(messageId: String, kind: String, cacheDir: File, regenerate: Boolean = false) {
        val thread = mutable.value.thread ?: return
        val owner = account?.user?.id ?: return
        val line = thread.lines.find { it.id == messageId } ?: return
        if (mutable.value.sending || mutable.value.mediaBusy.isNotBlank()) return
        if (kind != "audio" && kind != "image") return
        val hash = MediaText.hash(line.text, kind)
        val existing = mutable.value.media.find { it.messageId == messageId && it.kind == kind && it.sourceHash == hash }
        if (existing != null && !regenerate) {
            openAsset(existing, cacheDir)
            return
        }
        viewModelScope.launch {
            mutable.update { it.copy(mediaBusy = "$messageId:$kind", error = null) }
            val result = runCatching { withContext(Dispatchers.IO) { backend.generateChatMedia(owner, thread.id, messageId, kind, regenerate) } }
            if (mutable.value.thread?.id != thread.id) return@launch
            result.fold(
                onSuccess = { asset ->
                    mutable.update { state -> state.copy(mediaBusy = "", media = state.media.filterNot { it.id == asset.id } + asset) }
                    openAsset(asset, cacheDir)
                },
                onFailure = { error -> mutable.update { it.copy(mediaBusy = "", error = error.message ?: "消息素材暂时不可用，请稍后重试。") } },
            )
        }
    }

    private fun loadMedia(conversationId: String) {
        val owner = account?.user?.id ?: return
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.chatMedia(owner, conversationId) } }
            if (mutable.value.thread?.id != conversationId) return@launch
            loaded.onSuccess { board ->
                mutable.update { it.copy(media = board.assets, mediaPending = if (board.pendingKnown) board.pending else emptyList()) }
            }
        }
    }

    private fun openAsset(asset: ChatMediaAsset, cacheDir: File) {
        viewModelScope.launch {
            val saved = runCatching {
                withContext(Dispatchers.IO) {
                    val ext = if (asset.mimeType == "audio/wav") "wav" else if (asset.kind == "audio") "mp3" else if (asset.mimeType == "image/png") "png" else if (asset.mimeType == "image/webp") "webp" else "jpg"
                    val file = File(cacheDir, "chat-media-${asset.id}.$ext")
                    if (file.length() <= 0L) file.writeBytes(backend.chatMediaBytes(asset.url))
                    file.absolutePath
                }
            }
            if (mutable.value.thread?.lines?.any { it.id == asset.messageId } != true) return@launch
            saved.fold(
                onSuccess = { path ->
                    mutable.update {
                        if (asset.kind == "audio") it.copy(audioMessageId = asset.messageId, audioPath = path)
                        else it.copy(imageMessageId = asset.messageId, imagePath = path)
                    }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "素材没有载入") } },
            )
        }
    }

    private fun threadOf(talk: Talk, title: String = talk.title): ThreadUi =
        ThreadUi(talk.id, talk.characterId, title.ifBlank { talk.title }, talk.lines, talk.clock, talk.memory, talk.world, talk.opening)

    private fun reboundMemory(raw: String, original: List<Line>, copied: List<Line>): JSONObject? {
        val memory = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val count = memory.optInt("sourceCount", -1)
        val state = memory.optJSONObject("state") ?: return null
        if (memory.optInt("version") != 1 || count !in 1..original.size || count > copied.size) return null
        if (memory.optString("sourceFingerprint") != StoryFingerprint.of(original.take(count))) return null
        return JSONObject()
            .put("version", 1)
            .put("sourceCount", count)
            .put("sourceFingerprint", StoryFingerprint.of(copied.take(count)))
            .put("state", state)
    }

    private fun archive(card: JSONObject, thread: ThreadUi, opening: String): String {
        card.remove("authoringDraft")
        val root = JSONObject()
            .put("version", 1)
            .put("character", card)
            .put("worldClockMode", if (thread.clock == "realtime") "realtime" else "story")
            .put("messages", JSONArray().apply {
                thread.lines.forEach { line -> put(JSONObject().put("id", line.id).put("role", line.role).put("content", line.text)) }
            })
        val memory = memoryOf(thread.memory, thread.lines)
        if (memory != null) root.put("storyMemory", memory)
        val world = WorldJournal.rebind(thread.world, thread.lines, thread.lines)
        if (world != null) root.put("worldState", world)
        val snapshot = opening.takeIf { it.isNotBlank() }?.let { raw -> runCatching { JSONObject(raw) }.getOrNull() }
        if (snapshot != null) root.put("opening", snapshot)
        return root.toString(2)
    }

    private fun memoryOf(raw: String, lines: List<Line>): JSONObject? {
        val memory = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val count = memory.optInt("sourceCount", -1)
        if (memory.optInt("version") != 1 || count !in 1..lines.size) return null
        if (StoryFingerprint.of(lines.take(count)) != memory.optString("sourceFingerprint")) return null
        return memory
    }

    private fun worldOf(clock: String, raw: String): JSONObject {
        val mode = if (clock == "realtime") "realtime" else "story"
        val world = JSONObject().put("clockMode", mode)
        val journal = runCatching { JSONObject(raw) }.getOrNull() ?: return world
        val snapshots = journal.optJSONArray("snapshots") ?: return world
        val last = snapshots.optJSONObject(snapshots.length() - 1) ?: return world
        val state = last.optJSONObject("state") ?: return world
        val snapshotMode = last.optString("clockMode")
        if (snapshotMode != mode || !last.has("recordedAt")) return world
        return world.put("state", state).put("recordedAt", last.optLong("recordedAt")).put("previousClockMode", snapshotMode)
    }

    private fun openingSnapshot(character: StoryCharacter, index: Int): JSONObject {
        val greeting = character.greetings.getOrNull(index - 1)?.trim().orEmpty()
        if (greeting.isEmpty()) throw IllegalStateException("所选备选开场不存在")
        val messages = JSONArray().put(JSONObject().put("role", "assistant").put("content", greeting.take(15_000)))
        return JSONObject().put("version", 1).put("kind", "opening").put("source", "template").put("messages", messages)
    }

    private fun loadChrome(characterId: String) {
        viewModelScope.launch {
            val character = runCatching { withContext(Dispatchers.IO) { characters.getOrPut(characterId) { backend.character(characterId) } } }.getOrNull()
            val open = mutable.value.thread ?: return@launch
            if (open.characterId != characterId) return@launch
            val draft = mutable.value.draftReply
            val shown = if (draft.isEmpty()) open.lines else open.lines + Line("draft", "assistant", draft)
            mutable.update { it.copy(chrome = PlayText.chrome(character, shown), quickReplies = character?.replies.orEmpty(), cover = character?.cover.orEmpty()) }
        }
    }

    private fun wire(lines: List<Line>): JSONArray = JSONArray().apply {
        lines.forEach { put(JSONObject().put("id", it.id).put("role", it.role).put("content", it.text)) }
    }
}

internal object MediaText {
    fun hash(text: String, kind: String): String {
        val base = sha256(text)
        return if (kind == "audio") sha256("$base:spoken-quotes-v2") else base
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { byte -> "%02x".format(byte) }
    }
}
