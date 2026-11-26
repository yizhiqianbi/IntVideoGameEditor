package top.xumeng.app.feature.studio

import android.content.ClipData
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.nio.charset.CharacterCodingException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.AuthorDesk
import top.xumeng.app.core.network.CardLine
import top.xumeng.app.core.network.LoreEntry
import top.xumeng.app.core.network.GameSummary
import top.xumeng.app.core.network.ScenarioSummary
import top.xumeng.app.core.network.NovelWork
import top.xumeng.app.core.network.OwnCard
import top.xumeng.app.core.network.SavedPersona
import top.xumeng.app.core.network.SavedPreset
import top.xumeng.app.core.network.StudioField
import top.xumeng.app.core.network.StudioPanel
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.feature.novel.NovelViewModel
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark
import java.io.File
import java.util.UUID

private const val defaultVoice = "cRL5y2g9Apu45tuoclY0"

private val models = listOf(
    "gemma31" to "微光 · 轻语（默认 · 1× · 8金币起）",
    "qwen" to "微光 · 素笺（1× · 8金币起）",
    "deepseek" to "流萤 · 织梦（热选 · 2× · 16金币起）",
    "gemini31" to "流萤 · 灵犀（2× · 16金币起）",
    "gemini" to "绯月 · 绘境（长记忆 · 3× · 24金币起）",
    "grok" to "星穹 · 魅影（张力 · 5× · 40金币起）",
    "claude" to "星穹 · 墨韵（顶级文笔 · 6× · 48金币起）",
    "gemini4c" to "星穹 · 曜石（旗舰巅峰 · 6× · 48金币起）",
)

private data class VoiceChoice(val id: String, val label: String, val preview: String? = null)

private const val warmPreview = "https://r.breeze.blue/production/generated/audio/voice-preview/4e/36/4e36368e-f155-5f4b-9dfa-c7275d91e85b.mp3"
private const val whisperPreview = "https://r.breeze.blue/production/generated/audio/voice-preview/82/08/82086274-972d-567e-a32d-8d2bc2ce55ea.mp3"
private const val pactPreview = "https://r.breeze.blue/production/generated/audio/voice-preview/7c/2d/7c2de6ff-cdd8-5e2f-9bf3-c040dc0f6aa0.mp3"

private val voices = listOf(
    VoiceChoice(defaultVoice, "晚灯 · 默认", warmPreview),
    VoiceChoice("melotts", "自然中文 · 默认"),
    VoiceChoice("HE2pJq42vZv55x9j9gOh", "清川 · 女声", "https://storage.googleapis.com/eleven-public-prod/database/workspace/a039efafad594fe799a7b51529e19424/voices/HE2pJq42vZv55x9j9gOh/f032866b-9690-496d-b23b-c41b47a7fc91.mp3"),
    VoiceChoice("dGyruSqrNQLp4m4NQbHz", "微澜 · 女声", "https://storage.googleapis.com/eleven-public-prod/database/workspace/a039efafad594fe799a7b51529e19424/voices/dGyruSqrNQLp4m4NQbHz/2f76c70f-5347-478a-95fb-5fa8a8c5d50e.mp3"),
    VoiceChoice("BT0SH7Hb8NRPpT5xbCgg", "Lulu · 女声", "https://storage.googleapis.com/eleven-public-prod/database/workspace/451fb4b0fbd844bbb0c30fe416b6498e/voices/BT0SH7Hb8NRPpT5xbCgg/JMJTJG4vYXdZKcbYxLQv.mp3"),
    VoiceChoice("female-yujie", "御姐 · 女声", "https://scene.vidu.zone/media-asset/072356-YiaFlpiWzo4Twkxb.mp3"),
    VoiceChoice("female-shaonv", "软萌少女 · 女声", "https://scene.vidu.zone/media-asset/072356-Zp3xnBAgMpkKN0fb.mp3"),
    VoiceChoice("female-tianmei", "甜美 · 女声", "https://scene.vidu.zone/media-asset/072356-gc9rn0lig2Phdh1g.mp3"),
    VoiceChoice("female-chengshu", "成熟 · 女声", "https://scene.vidu.zone/media-asset/072356-HCbEW2grkWSOVYXB.mp3"),
    VoiceChoice("male-qn-qingse", "青涩青年 · 男声", "https://scene.vidu.zone/media-asset/072356-uLeoUwGWiQQZLiKH.mp3"),
    VoiceChoice("male-qn-daxuesheng", "清爽青年 · 男声", "https://scene.vidu.zone/media-asset/072356-T4kIZ1khgduPiW2i.mp3"),
    VoiceChoice("male-qn-badao", "霸道男声 · 男声", "https://scene.vidu.zone/media-asset/072356-ypZmFjxo84q476Ds.mp3"),
    VoiceChoice("male-qn-jingying", "沉稳男声 · 男声", "https://scene.vidu.zone/media-asset/072356-7hgJgP689lvUsESC.mp3"),
    VoiceChoice("breeze-whisper", "贴耳 · 魅魔", whisperPreview),
    VoiceChoice("breeze-pact", "夜契 · 魅魔", pactPreview),
    VoiceChoice("breeze-cling", "黏人 · 魅魔", whisperPreview),
    VoiceChoice("breeze-bite", "咬笑 · 魅魔", pactPreview),
)

data class AuthorUi(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val desk: AuthorDesk? = null,
    val editing: String? = null,
    val error: String? = null,
    val notice: String? = null,
    val coverUrl: String? = null,
    val coverPreview: String? = null,
    val coverFor: String? = null,
    val galleryUrl: String? = null,
    val galleryFor: String? = null,
    val galleryStamp: Int = 0,
    val pending: OwnCard? = null,
)

class AuthorViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow(AuthorUi())
    val state: StateFlow<AuthorUi> = mutable.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            mutable.update { it.copy(loading = it.desk == null, error = null) }
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.authorDesk() } }
            loaded.fold(
                onSuccess = { desk -> mutable.update { it.copy(loading = false, desk = desk) } },
                onFailure = { error -> mutable.update { it.copy(loading = false, error = error.message ?: "创作记录没有载入") } },
            )
        }
    }

    fun edit(id: String?) { mutable.update { it.copy(editing = id, pending = if (id?.startsWith("draft-") == true) it.pending else null, error = null, notice = null) } }

    fun importCard(raw: String) {
        val parsed = runCatching { backend.importCard(raw) }
        parsed.fold(
            onSuccess = { card ->
                mutable.update { it.copy(editing = "draft-${UUID.randomUUID()}", pending = card, error = null, notice = "角色卡已载入编辑器。保存后写入账号。") }
            },
            onFailure = { error -> mutable.update { it.copy(error = error.message ?: "无法读取角色卡，请选择有效的 JSON 文件。") } },
        )
    }

    fun exportCard(card: OwnCard): String = backend.exportCard(card)

    fun report(message: String) { mutable.update { it.copy(error = message, notice = null) } }

    fun uploadCover(resolver: android.content.ContentResolver, uri: Uri, cacheDir: File) {
        val editing = mutable.value.editing ?: return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val uploaded = runCatching {
                withContext(Dispatchers.IO) {
                    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw java.io.IOException("封面没有读到")
                    val mime = resolver.getType(uri) ?: sniffImage(bytes) ?: throw java.io.IOException("封面仅支持 PNG、JPEG、WebP 或 GIF")
                    val url = backend.uploadCover(bytes, mime)
                    val file = File(cacheDir, "cover-preview.png")
                    file.writeBytes(bytes)
                    url to file.absolutePath
                }
            }
            uploaded.fold(
                onSuccess = { (url, path) -> mutable.update { it.copy(busy = false, coverUrl = url, coverPreview = path, coverFor = editing, notice = "封面已上传，保存后会写进角色") } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "封面没有上传") } },
            )
        }
    }

    fun uploadGallery(resolver: android.content.ContentResolver, uri: Uri) {
        val editing = mutable.value.editing ?: return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val uploaded = runCatching {
                withContext(Dispatchers.IO) {
                    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw java.io.IOException("图片没有读到")
                    val mime = resolver.getType(uri) ?: sniffImage(bytes) ?: throw java.io.IOException("图片仅支持 PNG、JPEG、WebP 或 GIF")
                    backend.uploadCover(bytes, mime)
                }
            }
            uploaded.fold(
                onSuccess = { url -> mutable.update { it.copy(busy = false, galleryUrl = url, galleryFor = editing, galleryStamp = it.galleryStamp + 1, notice = "图片已上传，保存后会写进图库") } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "图片没有上传") } },
            )
        }
    }

    fun submit(card: OwnCard) {
        val desk = mutable.value.desk ?: return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null, notice = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.submitCard(desk.accountId, card) } }
            done.fold(
                onSuccess = { mutable.update { it.copy(busy = false, notice = "已送审，可在投稿里查看") } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "没有送审") } },
            )
        }
    }

    fun saveCard(card: OwnCard) {
        val desk = mutable.value.desk ?: return
        if (card.name.isBlank()) {
            mutable.update { it.copy(error = "角色名不能为空") }
            return
        }
        mutate("角色没有保存") { backend.saveCard(desk.version, desk.accountId, card) }
    }

    fun remove(id: String) {
        val desk = mutable.value.desk ?: return
        mutate("角色没有删除") { backend.deleteCard(id, desk.version, desk.accountId) }
    }

    fun setVoice(id: String, voice: String) {
        val desk = mutable.value.desk ?: return
        mutate("语音没有保存") { backend.setVoice(id, voice, desk.version, desk.accountId) }
    }

    fun saveSettings(nickname: String, persona: String, preset: String, model: String, maxTokens: Int, blocked: String, bio: String, gender: String, homeLayout: String, chatFontSize: String, chatFont: String, userBubble: String, assistantBubble: String, bubbleOpacity: Int, chatBackground: String, enterKey: String, theme: String, showFloatingChat: Boolean, floatingSize: String, floatingOpacity: Int) {
        val desk = mutable.value.desk ?: return
        val name = nickname.trim()
        if (name.isEmpty()) {
            mutable.update { it.copy(error = "称呼不能为空") }
            return
        }
        val blockedTags = blocked.split('\n', ',', '，').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (blockedTags.size > 50 || blockedTags.any { it.length > 40 }) {
            mutable.update { it.copy(error = "最多屏蔽 50 个标签，每个标签不超过 40 个字符") }
            return
        }
        if (bio.length > 500 || bio.contains('\u0000')) {
            mutable.update { it.copy(error = "个人简介不能超过 500 个字符。") }
            return
        }
        val layout = if (homeLayout == "single") "single" else "double"
        val size = if (chatFontSize == "small" || chatFontSize == "large" || chatFontSize == "xlarge") chatFontSize else "medium"
        val face = if (chatFont == "serif" || chatFont == "kai") chatFont else "system"
        val mine = userBubble.trim().lowercase()
        val theirs = assistantBubble.trim().lowercase()
        if ((mine.isNotEmpty() && !Regex("^#[0-9a-f]{6}$").matches(mine)) || (theirs.isNotEmpty() && !Regex("^#[0-9a-f]{6}$").matches(theirs))) {
            mutable.update { it.copy(error = "气泡颜色需要是 #rrggbb，留空则用默认颜色。") }
            return
        }
        val opacity = bubbleOpacity.coerceIn(20, 100)
        val backdrop = if (chatBackground == "plain" || chatBackground == "site") chatBackground else "cover"
        val enter = if (enterKey == "send" || enterKey == "newline") enterKey else "auto"
        val appearance = if (theme == "light" || theme == "system") theme else "dark"
        val floatSize = if (floatingSize == "small" || floatingSize == "large") floatingSize else "medium"
        val floatOpacity = floatingOpacity.coerceIn(20, 100)
        top.xumeng.app.shell.AppTheme.mode = appearance
        top.xumeng.app.shell.AppTheme.showFloatingChat = showFloatingChat
        top.xumeng.app.shell.AppTheme.floatingSize = floatSize
        top.xumeng.app.shell.AppTheme.floatingOpacity = floatOpacity
        val chosen = gender.takeIf { it == "male" || it == "female" || it == "other" }
        if (gender.isNotEmpty() && chosen == null) {
            mutable.update { it.copy(error = "性别选项无效。") }
            return
        }
        val preferences = JSONObject()
            .put("nickname", name.take(30))
            .put("persona", persona.take(4000))
            .put("preset", preset.take(8000))
            .put("model", model)
            .put("maxTokens", maxTokens.coerceIn(128, 4096))
            .put("blockedTags", JSONArray(blockedTags))
            .put("bio", bio.take(500))
            .put("gender", if (chosen == null) JSONObject.NULL else chosen)
            .put("homeLayout", layout)
            .put("chatFontSize", size)
            .put("chatFont", face)
            .put("userBubbleColor", mine)
            .put("assistantBubbleColor", theirs)
            .put("bubbleOpacity", opacity)
            .put("chatBackground", backdrop)
            .put("enterKey", enter)
            .put("theme", appearance)
            .put("dark", appearance != "light")
            .put("showFloatingChat", showFloatingChat)
            .put("floatingSize", floatSize)
            .put("floatingOpacity", floatOpacity)
        mutate("设置没有保存") { backend.savePreferences(desk.version, desk.accountId, preferences) }
    }

    fun addPreset(name: String, content: String) {
        val desk = mutable.value.desk ?: return
        val title = name.trim()
        if (title.isEmpty() || content.isBlank()) return
        val next = desk.presets + SavedPreset(UUID.randomUUID().toString(), title.take(80), content.take(8000))
        writePresets(desk, next, content.take(8000))
    }

    fun usePreset(content: String) {
        val desk = mutable.value.desk ?: return
        mutate("预设没有启用") {
            backend.savePreferences(desk.version, desk.accountId, JSONObject().put("preset", content.take(8000)))
        }
    }

    fun removePreset(id: String) {
        val desk = mutable.value.desk ?: return
        writePresets(desk, desk.presets.filterNot { it.id == id }, null)
    }

    fun savePersona(id: String, name: String, content: String) {
        val desk = mutable.value.desk ?: return
        val title = name.trim()
        if (title.isEmpty() || title.length > 80 || title.contains('\u0000') || content.length > 4000 || content.contains('\u0000')) {
            mutable.update { it.copy(error = "人设名称需要 1 至 80 字，正文不超过 4000 字。") }
            return
        }
        val next = if (id.isBlank()) {
            if (desk.personas.size >= 30) {
                mutable.update { it.copy(error = "人设库最多保存 30 个人设，请先删除一个。") }
                return
            }
            desk.personas + SavedPersona(UUID.randomUUID().toString(), title, content)
        } else {
            if (desk.personas.none { it.id == id }) return
            desk.personas.map { if (it.id == id) it.copy(name = title, content = content) else it }
        }
        writePersonas(desk, next, null)
    }

    fun deletePersona(id: String) {
        val desk = mutable.value.desk ?: return
        val next = desk.personas.filterNot { it.id == id }
        val assigned = desk.conversationPersonas.filterValues { it != id }
        writePersonas(desk, next, assigned)
    }

    private fun writePersonas(desk: AuthorDesk, personas: List<SavedPersona>, assigned: Map<String, String>?) {
        val array = JSONArray()
        personas.forEach { array.put(JSONObject().put("id", it.id).put("name", it.name).put("content", it.content)) }
        val preferences = JSONObject().put("personas", array)
        if (assigned != null) {
            val map = JSONObject()
            assigned.forEach { (key, value) -> map.put(key, value) }
            preferences.put("conversationPersonas", map)
        }
        mutate("人设没有保存") { backend.savePreferences(desk.version, desk.accountId, preferences) }
    }

    private fun writePresets(desk: AuthorDesk, presets: List<SavedPreset>, active: String?) {
        val array = JSONArray()
        presets.forEach { array.put(JSONObject().put("id", it.id).put("name", it.name).put("content", it.content)) }
        val preferences = JSONObject().put("presets", array)
        if (active != null) preferences.put("preset", active)
        mutate("预设没有保存") { backend.savePreferences(desk.version, desk.accountId, preferences) }
    }

    private fun mutate(fallback: String, block: () -> AuthorDesk) {
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { block() } }
            done.fold(
                onSuccess = { desk -> mutable.update { it.copy(busy = false, loading = false, desk = desk, editing = null, pending = null) } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: fallback) } },
            )
        }
    }
}

@Composable
fun StudioScreen(
    onChat: (String, String) -> Unit,
    onNovels: () -> Unit = {},
    onGenerate: () -> Unit = {},
    onAccount: () -> Unit = {},
) {
    val model = viewModel<AuthorViewModel>()
    val gamesModel = viewModel<GameViewModel>()
    val scenariosModel = viewModel<ScenarioViewModel>()
    val state by model.state.collectAsState()
    val games by gamesModel.state.collectAsState()
    val scenarios by scenariosModel.state.collectAsState()
    val desk = state.desk
    val editing = state.editing
    val context = LocalContext.current
    val cardPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val text = runCatching {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                var total = 0
                while (true) {
                    val count = input.read(chunk)
                    if (count < 0) break
                    total += count
                    if (total > 5_000_000) throw java.io.IOException("角色卡文件不能超过 5 MB。")
                    buffer.write(chunk, 0, count)
                }
                val decoder = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                try {
                    decoder.decode(java.nio.ByteBuffer.wrap(buffer.toByteArray())).toString()
                } catch (_: CharacterCodingException) {
                    throw java.io.IOException("文件不是有效的 UTF-8 文本，请先另存为 UTF-8，再导入。")
                }
            } ?: throw java.io.IOException("无法读取角色卡，请选择有效的 JSON 文件。")
        }
        text.fold(onSuccess = model::importCard, onFailure = { model.report(it.message ?: "无法读取角色卡，请选择有效的 JSON 文件。") })
    }
    LaunchedEffect(Unit) { model.refresh() }
    LaunchedEffect(desk?.guest, desk?.accountId) {
        val loaded = desk ?: return@LaunchedEffect
        if (loaded.guest) {
            gamesModel.showGuest()
            scenariosModel.showGuest()
        } else {
            gamesModel.refresh()
            scenariosModel.refresh()
        }
    }
    when {
        editing != null && desk != null -> CardEditor(
            desk, editing, state, model::edit, model::saveCard, model::submit, model::uploadCover, model::uploadGallery, model::remove, onChat,
            export = { card ->
                runCatching { shareCard(context, "${card.name.ifBlank { "角色卡" }}.json", model.exportCard(card)) }
                    .onFailure { model.report(it.message ?: "导出角色卡不能超过 5 MB，请减少设定内容。") }
            },
            import = { cardPicker.launch("*/*") },
        )
        games.screen -> GameStudioScreen(games, gamesModel, onAccount)
        scenarios.screen -> ScenarioStudioScreen(scenarios, scenariosModel, onAccount)
        else -> CreateHub(state, model, games, gamesModel, scenarios, scenariosModel, onNovels, onGenerate, onAccount)
    }
}

@Composable
fun SettingsScreen() {
    val model = viewModel<AuthorViewModel>()
    val state by model.state.collectAsState()
    val desk = state.desk
    Column(Modifier.fillMaxSize().background(Ink.background)) {
        Heading("user", "设置")
        when {
            desk == null && state.loading -> Waiting("正在读取设置")
            desk == null -> Waiting(state.error ?: "设置没有载入", model::refresh)
            else -> SettingsForm(desk, state.busy, state.error, model::saveSettings)
        }
    }
}

@Composable
fun PresetScreen() {
    val model = viewModel<AuthorViewModel>()
    val state by model.state.collectAsState()
    val desk = state.desk
    Column(Modifier.fillMaxSize().background(Ink.background)) {
        Heading("sliders", "模型与预设")
        when {
            desk == null && state.loading -> Waiting("正在读取预设")
            desk == null -> Waiting(state.error ?: "预设没有载入", model::refresh)
            else -> PresetForm(desk, state.busy, state.error, model::usePreset, model::addPreset, model::removePreset, model::savePersona, model::deletePersona)
        }
    }
}

@Composable
fun VoiceScreen() {
    val model = viewModel<AuthorViewModel>()
    val state by model.state.collectAsState()
    val desk = state.desk
    Column(Modifier.fillMaxSize().background(Ink.background)) {
        Heading("volume", "角色语音")
        when {
            desk == null && state.loading -> Waiting("正在读取语音")
            desk == null -> Waiting(state.error ?: "语音没有载入", model::refresh)
            desk.cards.isEmpty() -> Waiting("先在创作里做一张角色，再给它选声音")
            else -> VoiceForm(desk, state.busy, state.error, model::setVoice)
        }
    }
}

private val workKinds = listOf(
    "all" to "全部",
    "character" to "角色",
    "novel" to "小说",
    "story" to "故事",
    "game" to "游戏",
    "scenario" to "团本",
)

private val workDay = java.time.format.DateTimeFormatter.ofPattern("yyyy/M/d", java.util.Locale.CHINA)
    .withZone(java.time.ZoneId.of("Asia/Shanghai"))

private data class HubWork(
    val kind: String,
    val id: String,
    val title: String,
    val synopsis: String,
    val detail: String,
    val updatedAt: Long,
    val icon: String,
)

private data class FeatureNote(val body: String, val action: String?)

@Composable
private fun CreateHub(
    state: AuthorUi,
    author: AuthorViewModel,
    games: GameUi,
    gamesModel: GameViewModel,
    scenarios: ScenarioUi,
    scenariosModel: ScenarioViewModel,
    onNovels: () -> Unit,
    onGenerate: () -> Unit,
    onAccount: () -> Unit,
) {
    val novelsModel = viewModel<NovelViewModel>()
    val novels by novelsModel.state.collectAsState()
    val desk = state.desk
    val registered = desk != null && !desk.guest
    var pending by remember { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { author.refresh() }
    LaunchedEffect(desk?.guest, desk?.accountId) {
        if (desk != null && !desk.guest) novelsModel.refresh()
    }
    val novelsReady = !novels.loading && novels.error == null
    LaunchedEffect(desk, pending, novelsReady) {
        val loaded = desk ?: return@LaunchedEffect
        when (pending) {
            "character" -> {
                pending = ""
                author.edit("new")
            }
            "novel" -> when {
                loaded.guest -> {
                    pending = ""
                    onAccount()
                }
                novelsReady -> {
                    pending = ""
                    novelsModel.create("novel")
                    onNovels()
                }
                !novels.loading -> pending = ""
            }
            "game" -> {
                pending = ""
                gamesModel.openLibrary(loaded.guest)
            }
            "scenario" -> {
                pending = ""
                if (loaded.guest) onAccount() else scenariosModel.createTemplate()
            }
        }
    }
    val works = if (desk == null) emptyList() else hubWorks(
        desk,
        if (registered) novels.works else emptyList(),
        if (registered) games.games else emptyList(),
        if (registered) scenarios.scenarios else emptyList(),
    )
    val needle = query.trim()
    val filtered = works.filter { work ->
        (kind == "all" || work.kind == kind) &&
            (needle.isEmpty() || "${work.title}\n${work.synopsis}".lowercase().contains(needle.lowercase()))
    }
    val cloudErrors = buildList {
        if (registered && novels.error != null) add("小说和故事")
        if (registered && games.listError != null) add("游戏")
        if (registered && scenarios.listError != null) add("团本")
    }
    val cloudLoading = registered && (novels.loading || games.loading || !games.loaded || scenarios.loading || !scenarios.loaded)
    val loadingWorks = (desk == null && state.loading) || cloudLoading
    val filtering = needle.isNotEmpty() || kind != "all"
    fun begin(key: String) {
        note = if (key == "girlfriend") key else ""
        when (key) {
            "character" -> if (desk == null) pending = "character" else author.edit("new")
            "novel" -> when {
                desk == null -> pending = "novel"
                desk.guest -> onAccount()
                novelsReady -> {
                    novelsModel.create("novel")
                    onNovels()
                }
                else -> pending = "novel"
            }
            "game" -> if (desk == null) pending = "game" else gamesModel.openLibrary(desk.guest)
            "scenario" -> when {
                desk == null -> pending = "scenario"
                desk.guest -> onAccount()
                else -> scenariosModel.createTemplate()
            }
            "generate" -> onGenerate()
        }
    }
    LazyColumn(Modifier.fillMaxSize().background(Ink.background), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 28.dp)) {
        item {
            Text("叙梦 · 创作中心", color = Ink.muted, fontSize = 12.sp)
            Text("开始一段新创作", color = Ink.text, fontSize = 23.sp, modifier = Modifier.padding(top = 8.dp))
            Text("写角色与故事，也可以制作游戏、邀请朋友一起冒险。", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
        }
        item {
            Column(Modifier.padding(top = 18.dp).semantics { contentDescription = "开始创作" }) {
                listOf(
                    listOf("character" to true, "novel" to false),
                    listOf("girlfriend" to false, "game" to false),
                    listOf("scenario" to false, "generate" to false),
                ).forEach { row ->
                    Row(Modifier.fillMaxWidth().padding(top = 9.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        row.forEach { (key, primary) ->
                            val entry = startEntry(key)
                            StartCard(entry.first, entry.second, entry.third, primary, Modifier.weight(1f)) { begin(key) }
                        }
                    }
                }
            }
        }
        if (note == "girlfriend") {
            item { FeatureNoteBlock(featureNote(note, desk?.guest != false), onAccount, Modifier.padding(top = 12.dp)) }
        }
        item {
            Box(Modifier.padding(top = 28.dp).fillMaxWidth().height(1.dp).background(Ink.line))
            Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("我的作品", color = Ink.text, fontSize = 18.sp, modifier = Modifier.weight(1f))
                Row(
                    Modifier.clickable(enabled = !loadingWorks) {
                        author.refresh()
                        if (registered) {
                            novelsModel.refresh()
                            gamesModel.refresh()
                            scenariosModel.refresh()
                        }
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Mark("refresh", size = 16.dp, color = Ink.muted)
                    Text(if (loadingWorks) "正在加载作品" else "刷新作品", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(start = 6.dp))
                }
            }
            Row(Modifier.padding(top = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                workKinds.forEach { (key, label) ->
                    val selected = kind == key
                    Text(
                        label,
                        color = if (selected) Ink.text else Ink.muted,
                        fontSize = 13.sp,
                        modifier = Modifier.clip(RoundedCornerShape(7.dp)).background(if (selected) Ink.surface else Color.Transparent).clickable { kind = key }.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }
            TextField(
                value = query,
                onValueChange = { query = it.take(120) },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).semantics { contentDescription = "搜索我的作品" },
                singleLine = true,
                placeholder = { Text("查找作品") },
                leadingIcon = { Mark("search", color = Ink.muted) },
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
        }
        if (desk?.guest == true) {
            item {
                Text("登录后可查看云端作品并保存游戏、小说和团本。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                Text("登录 / 注册", color = Ink.accent, fontSize = 13.sp, modifier = Modifier.clickable(onClick = onAccount).padding(vertical = 6.dp))
            }
        }
        state.error?.let { message ->
            item { Text(message, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
        }
        if (cloudErrors.isNotEmpty()) {
            item { Text("${cloudErrors.joinToString("、")}暂时加载失败。其他作品仍可使用，请点击刷新重试。", color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
        }
        when {
            filtered.isEmpty() -> item {
                val title = when {
                    loadingWorks -> "正在加载作品"
                    filtering -> "没有匹配的已加载作品"
                    state.error != null || cloudErrors.isNotEmpty() -> "暂时未能载入作品"
                    else -> "你的第一部作品，从这里开始"
                }
                Column(Modifier.fillMaxWidth().padding(top = 36.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Mark(if (filtering) "search" else "edit", size = 32.dp, color = Ink.muted)
                    Text(title, color = Ink.text, fontSize = 15.sp, modifier = Modifier.padding(top = 12.dp))
                    Text(
                        if (filtering) "换个词或选择其他类型。" else "从上方选择一种创作方式。保存后可在这里继续。",
                        color = Ink.muted,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
            else -> items(filtered, key = { "${it.kind}:${it.id}" }) { work ->
                WorkRow(work) {
                    when (work.kind) {
                        "character" -> author.edit(work.id)
                        "novel", "story" -> {
                            novelsModel.open(work.id)
                            onNovels()
                        }
                        "game" -> gamesModel.open(work.id)
                        "scenario" -> scenariosModel.open(work.id)
                    }
                }
            }
        }
    }
}

private fun startEntry(key: String): Triple<String, String, String> = when (key) {
    "character" -> Triple("user", "创建角色", "人设、开场与世界书")
    "novel" -> Triple("book", "小说与故事", "人物、大纲与章节")
    "girlfriend" -> Triple("upload", "上传女友", "封面、相册和人设")
    "game" -> Triple("play", "上传游戏", "导入 HTML、压缩包或备份")
    "scenario" -> Triple("users", "创建团本", "编写剧本，组队推进")
    else -> Triple("image", "生成", "图片、视频和模板")
}

private fun featureNote(kind: String, guest: Boolean): FeatureNote = when (kind) {
    "girlfriend" -> if (guest) FeatureNote("登录后可以保存封面、相册和人设。", "登录 / 注册")
    else FeatureNote("封面、相册和人设。封面、相册，人设按 MaiBot 的身份、行为、说法和私聊来写。", null)
    else -> if (guest) FeatureNote("登录后保存私人团本。剧本和主持笔记由你管理，房间仅对受邀参与者开放。", "登录 / 注册")
    else FeatureNote("编写剧本，组队推进。剧本和主持笔记由你管理，房间仅对受邀参与者开放。", null)
}

@Composable
private fun FeatureNoteBlock(note: FeatureNote, onAccount: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().background(Ink.surface, RoundedCornerShape(12.dp)).padding(14.dp)) {
        Text(note.body, color = Ink.muted, fontSize = 13.sp)
        note.action?.let { label ->
            Text(label, color = Ink.accent, fontSize = 14.sp, modifier = Modifier.clickable(onClick = onAccount).padding(top = 8.dp))
        }
    }
}

@Composable
private fun StartCard(icon: String, title: String, hint: String, primary: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier
            .heightIn(min = 124.dp)
            .clip(shape)
            .background(if (primary) Ink.accent.copy(alpha = 0.12f) else Ink.surface)
            .border(1.dp, if (primary) Ink.accent.copy(alpha = 0.4f) else Ink.line, shape)
            .clickable(onClick = onClick)
            .padding(14.dp)
            .semantics { contentDescription = title },
    ) {
        Mark(icon, size = 22.dp, color = Ink.accent)
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = Ink.text, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Mark("plus", size = 16.dp, color = Ink.muted)
        }
        Text(hint, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun WorkRow(work: HubWork, onOpen: () -> Unit) {
    val day = if (work.updatedAt > 0) workDay.format(java.time.Instant.ofEpochMilli(work.updatedAt)) else ""
    val meta = listOf(kindLabel(work.kind), work.detail, day).filter { it.isNotEmpty() }.joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(40.dp).background(Ink.line, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Mark(work.icon, color = Ink.muted)
        }
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Text(work.title, color = Ink.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(work.synopsis.ifBlank { "还没有填写简介" }, color = Ink.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
            Text(meta, color = Ink.muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
        }
        Row(Modifier.padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("继续创作", color = Ink.accent, fontSize = 12.sp, maxLines = 1)
            Mark("chevron", size = 14.dp, color = Ink.accent)
        }
    }
}

private fun hubWorks(desk: AuthorDesk, novels: List<NovelWork>, games: List<GameSummary>, scenarios: List<ScenarioSummary>): List<HubWork> {
    val characters = desk.cards.map { card ->
        HubWork("character", card.id, card.name.ifBlank { "未命名作品" }, cardBlurb(card), "私人角色草稿", card.createdAt, "user")
    }
    val books = if (desk.guest) emptyList() else novels.map { work ->
        val story = work.type == "story"
        HubWork(
            if (story) "story" else "novel",
            work.id,
            work.title.ifBlank { "未命名作品" },
            work.synopsis.trim(),
            "${work.chapterCount} 章 · ${java.text.NumberFormat.getIntegerInstance(java.util.Locale.CHINA).format(work.wordCount.coerceAtLeast(0))} 字",
            work.updatedAt,
            "book",
        )
    }
    val played = if (desk.guest) emptyList() else games.map { game ->
        HubWork("game", game.id, game.title.ifBlank { "未命名作品" }, game.synopsis, "私人 HTML 项目", game.updatedAt, "play")
    }
    val scripts = if (desk.guest) emptyList() else scenarios.map { item ->
        HubWork("scenario", item.id, item.title.ifBlank { "未命名作品" }, item.synopsis, "私人团本剧本", item.updatedAt, "users")
    }
    return (characters + books + played + scripts).sortedByDescending { it.updatedAt }
}

private fun kindLabel(kind: String): String = when (kind) {
    "character" -> "角色"
    "story" -> "故事"
    "game" -> "游戏"
    "scenario" -> "团本"
    else -> "小说"
}

private fun cardBlurb(card: OwnCard): String {
    val source = card.introduction.ifBlank { card.description }.replace(Regex("<[^>\\n]*>"), "\n")
    val line = source.lineSequence().map { it.replace(Regex("\\s+"), " ").trim() }.firstOrNull { it.length >= 2 }.orEmpty()
    val sentence = line.split('。', '！', '？', '!', '?').firstOrNull()?.trim().orEmpty()
    if (sentence.isEmpty()) return ""
    return if (sentence.length > 48) sentence.take(48) + "…" else sentence
}

@Composable
private fun CardEditor(
    desk: AuthorDesk,
    editing: String,
    state: AuthorUi,
    close: (String?) -> Unit,
    save: (OwnCard) -> Unit,
    submit: (OwnCard) -> Unit,
    upload: (android.content.ContentResolver, Uri, File) -> Unit,
    uploadGallery: (android.content.ContentResolver, Uri) -> Unit,
    remove: (String) -> Unit,
    onChat: (String, String) -> Unit,
    export: (OwnCard) -> Unit,
    import: () -> Unit,
) {
    val current = if (editing.startsWith("draft-")) state.pending else desk.cards.find { it.id == editing }
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) upload(context.contentResolver, uri, context.cacheDir)
    }
    val galleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) uploadGallery(context.contentResolver, uri)
    }
    var name by rememberSaveable(editing) { mutableStateOf(current?.name.orEmpty()) }
    var tagsText by rememberSaveable(editing) { mutableStateOf(current?.tags?.joinToString("，").orEmpty().ifBlank { "自定义" }) }
    var description by rememberSaveable(editing) { mutableStateOf(current?.description.orEmpty()) }
    var introduction by rememberSaveable(editing) { mutableStateOf(current?.introduction.orEmpty()) }
    var notes by rememberSaveable(editing) { mutableStateOf(current?.notes.orEmpty()) }
    var personality by rememberSaveable(editing) { mutableStateOf(current?.personality.orEmpty()) }
    var scenario by rememberSaveable(editing) { mutableStateOf(current?.scenario.orEmpty()) }
    var systemPrompt by rememberSaveable(editing) { mutableStateOf(current?.systemPrompt.orEmpty()) }
    var postHistory by rememberSaveable(editing) { mutableStateOf(current?.postHistory.orEmpty()) }
    var examples by rememberSaveable(editing) { mutableStateOf(current?.examples.orEmpty()) }
    var appearance by rememberSaveable(editing) { mutableStateOf(current?.appearance.orEmpty()) }
    var interactionSettings by rememberSaveable(editing) { mutableStateOf(current?.interactionSettings.orEmpty()) }
    var cover by rememberSaveable(editing) { mutableStateOf(current?.cover.orEmpty()) }
    var statusTemplate by rememberSaveable(editing) { mutableStateOf(current?.statusTemplate.orEmpty()) }
    var statusInitial by rememberSaveable(editing) { mutableStateOf(current?.statusInitial.orEmpty()) }
    var statusRules by rememberSaveable(editing) { mutableStateOf(current?.statusRules.orEmpty()) }
    var bookName by rememberSaveable(editing) { mutableStateOf(current?.bookName.orEmpty()) }
    var bookDescription by rememberSaveable(editing) { mutableStateOf(current?.bookDescription.orEmpty()) }
    var bookScan by rememberSaveable(editing) { mutableStateOf(current?.bookScan?.toString().orEmpty()) }
    val openings = remember(editing) {
        mutableStateListOf<CardLine>().apply {
            val stored = current?.openings.orEmpty()
            if (stored.isNotEmpty()) addAll(stored)
            else add(CardLine("assistant", current?.firstMessage.orEmpty()))
        }
    }
    val greetings = remember(editing) { mutableStateListOf<String>().apply { addAll(current?.greetings.orEmpty()) } }
    val replies = remember(editing) { mutableStateListOf<String>().apply { addAll(current?.replies.orEmpty()) } }
    val gallery = remember(editing) { mutableStateListOf<String>().apply { addAll(current?.gallery.orEmpty()) } }
    val lore = remember(editing) { mutableStateListOf<LoreEntry>().apply { addAll(current?.lore.orEmpty()) } }
    val panels = remember(editing) { mutableStateListOf<StudioPanel>().apply { addAll(current?.panels.orEmpty()) } }
    LaunchedEffect(state.coverUrl, state.coverFor) {
        if (state.coverFor == editing && !state.coverUrl.isNullOrBlank()) cover = state.coverUrl
    }
    LaunchedEffect(state.galleryStamp) {
        val url = state.galleryUrl
        if (state.galleryFor == editing && state.galleryStamp > 0 && !url.isNullOrBlank() && gallery.size < 20 && url !in gallery) gallery.add(url)
    }
    val busy = state.busy
    var confirmDelete by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Ink.background)) {
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text("返回", color = Ink.muted, modifier = Modifier.clickable { close(null) }.padding(bottom = 8.dp))
        Text(if (editing == "new") "新角色" else "编辑角色", color = Ink.text, fontSize = 22.sp)
        Field(name, { name = it.take(120) }, "名字")
        Field(tagsText, { tagsText = it.take(4500) }, "标签，用逗号分开")
        Field(description, { description = it.take(15_000) }, "简介", 3)
        Field(introduction, { introduction = it.take(15_000) }, "角色介绍", 4)
        Field(notes, { notes = it.take(15_000) }, "作者备注", 3)
        Text("图库", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
        gallery.forEachIndexed { index, url ->
            Field(url, { gallery[index] = it.take(2048) }, "图片地址 ${index + 1}")
            Text("移除图片", color = Color(0xFFFF8AA3), modifier = Modifier.clickable { gallery.removeAt(index) }.padding(vertical = 4.dp))
        }
        Text(if (busy) "上传中" else "上传图片", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy && gallery.size < 20) { galleryPicker.launch("image/*") }.padding(vertical = 6.dp))
        Text("或填写图片地址", color = Ink.muted, modifier = Modifier.clickable(enabled = gallery.size < 20) { gallery.add("") }.padding(bottom = 6.dp))
        Field(personality, { personality = it.take(15_000) }, "性格", 3)
        Field(appearance, { appearance = it.take(4_000) }, "外貌", 3)
        Field(interactionSettings, { interactionSettings = it.take(8_000) }, "互动设置", 4)
        Field(scenario, { scenario = it.take(15_000) }, "场景", 3)
        Text("开场消息", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
        openings.forEachIndexed { index, line ->
            Text(if (line.role == "user") "用户" else "角色", color = Ink.accent, modifier = Modifier.clickable {
                openings[index] = line.copy(role = if (line.role == "user") "assistant" else "user")
            }.padding(top = 8.dp))
            Field(line.content, { next -> openings[index] = openings[index].copy(content = next.take(15_000)) }, "第 ${index + 1} 条", 3)
            if (openings.size > 1) Text("移除这条", color = Color(0xFFFF8AA3), modifier = Modifier.clickable { openings.removeAt(index) }.padding(vertical = 4.dp))
        }
        Text("加一条开场", color = Ink.accent, modifier = Modifier.clickable(enabled = openings.size < 20) { openings.add(CardLine("assistant", "")) }.padding(vertical = 6.dp))
        Text("备选开场", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 8.dp))
        greetings.forEachIndexed { index, greeting ->
            Field(greeting, { greetings[index] = it.take(15_000) }, "备选开场 ${index + 1}", 3)
            Text("移除备选", color = Color(0xFFFF8AA3), modifier = Modifier.clickable { greetings.removeAt(index) }.padding(vertical = 4.dp))
        }
        Text("加一个备选开场", color = Ink.accent, modifier = Modifier.clickable(enabled = greetings.size < 20) { greetings.add("") }.padding(vertical = 6.dp))
        Text("建议回复", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 8.dp))
        replies.forEachIndexed { index, reply ->
            Field(reply, { replies[index] = it.take(500) }, "开场回应 ${index + 1}")
            Text("移除回应", color = Color(0xFFFF8AA3), modifier = Modifier.clickable { replies.removeAt(index) }.padding(vertical = 4.dp))
        }
        Text("加一个建议回复", color = Ink.accent, modifier = Modifier.clickable(enabled = replies.size < 12) { replies.add("") }.padding(vertical = 6.dp))
        Field(systemPrompt, { systemPrompt = it.take(15_000) }, "系统设定", 4)
        Field(postHistory, { postHistory = it.take(15_000) }, "后置指令，放在聊天历史之后", 4)
        Field(examples, { examples = it.take(15_000) }, "对话示例，用来展示语气", 5)
        Text("状态栏", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
        Field(statusTemplate, { statusTemplate = it.take(4_000) }, "模板，每行写一个字段，例如 地点：未知", 3)
        Field(statusInitial, { statusInitial = it.take(4_000) }, "初始状态", 3)
        Field(statusRules, { statusRules = it.take(8_000) }, "更新规则", 3)
        Text("互动面板", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
        panelPresets().forEach { preset ->
            val enabled = panels.any { it.id == preset.id }
            Text(
                if (enabled) "已开 · ${preset.title}" else preset.title,
                color = if (enabled) Ink.accent else Ink.text,
                modifier = Modifier.clickable {
                    if (enabled) panels.removeAll { it.id == preset.id }
                    else if (panels.size < 6 && panels.none { it.title == preset.title }) panels.add(preset)
                }.padding(vertical = 4.dp),
            )
        }
        panels.forEachIndexed { panelIndex, panel ->
            Text(panel.title, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
            panel.fields.forEachIndexed { fieldIndex, field ->
                val hint = if (field.type == "meter") "${field.name} · 0–100" else field.name
                Field(field.initial, { next ->
                    val fields = panel.fields.toMutableList()
                    fields[fieldIndex] = field.copy(initial = next.take(200))
                    panels[panelIndex] = panel.copy(fields = fields)
                }, hint)
            }
            if (panelPresets().none { it.id == panel.id }) {
                Text("移除${panel.title}", color = Color(0xFFFF8AA3), modifier = Modifier.clickable { panels.removeAt(panelIndex) }.padding(vertical = 4.dp))
            }
        }
        Text("世界书", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
        Field(bookName, { bookName = it.take(120) }, "世界书名称，可空")
        Field(bookDescription, { bookDescription = it.take(2_000) }, "世界书说明，可空", 2)
        Field(bookScan, { bookScan = it.filter(Char::isDigit).take(2) }, "扫描最近消息数，1–40，可空")
        lore.forEachIndexed { index, entry ->
            Field(entry.name, { lore[index] = lore[index].copy(name = it.take(120)) }, "条目名，可空")
            Field(entry.keys, { lore[index] = lore[index].copy(keys = it.take(2500)) }, "关键词，用逗号分开")
            Field(entry.secondary, { lore[index] = lore[index].copy(secondary = it.take(2500)) }, "辅助词，用逗号分开")
            Field(entry.content, { lore[index] = lore[index].copy(content = it.take(100_000)) }, "条目正文", 3)
            Field(entry.order?.toString().orEmpty(), { raw ->
                val digits = raw.filter(Char::isDigit).take(6)
                lore[index] = lore[index].copy(order = digits.toIntOrNull()?.coerceAtMost(100_000))
            }, "优先级，越小越先看到，可空")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(if (entry.constant) "常驻" else "按关键词", color = if (entry.constant) Ink.accent else Ink.muted, modifier = Modifier.clickable { lore[index] = lore[index].copy(constant = !lore[index].constant) }.padding(vertical = 6.dp))
                Text(if (entry.enabled) "启用" else "停用", color = if (entry.enabled) Ink.accent else Ink.muted, modifier = Modifier.clickable { lore[index] = lore[index].copy(enabled = !lore[index].enabled) }.padding(vertical = 6.dp))
                Text(if (entry.selective) "要辅助词" else "不要求辅助词", color = if (entry.selective) Ink.accent else Ink.muted, modifier = Modifier.clickable { lore[index] = lore[index].copy(selective = !lore[index].selective) }.padding(vertical = 6.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(if (entry.caseSensitive) "区分大小写" else "忽略大小写", color = if (entry.caseSensitive) Ink.accent else Ink.muted, modifier = Modifier.clickable { lore[index] = lore[index].copy(caseSensitive = !lore[index].caseSensitive) }.padding(vertical = 6.dp))
                Text(when (entry.position) {
                    "before_char" -> "放在角色设定前"
                    "after_char" -> "放在角色设定后"
                    else -> "默认位置"
                }, color = Ink.text, modifier = Modifier.clickable {
                    val next = when (lore[index].position) {
                        "" -> "before_char"
                        "before_char" -> "after_char"
                        else -> ""
                    }
                    lore[index] = lore[index].copy(position = next)
                }.padding(vertical = 6.dp))
                Text("移除条目", color = Color(0xFFFF8AA3), modifier = Modifier.clickable { lore.removeAt(index) }.padding(vertical = 6.dp))
            }
        }
        Text("加一条世界书", color = Ink.accent, modifier = Modifier.clickable(enabled = lore.size < 200) { lore.add(LoreEntry(UUID.randomUUID().toString(), "", "", "", false)) }.padding(vertical = 8.dp))
        if (state.coverFor == editing && !state.coverPreview.isNullOrBlank()) {
            val bitmap = BitmapFactory.decodeFile(state.coverPreview)?.asImageBitmap()
            if (bitmap != null) Image(bitmap, contentDescription = "封面", modifier = Modifier.fillMaxWidth().height(220.dp).padding(top = 8.dp), contentScale = ContentScale.Fit)
        }
        Text(if (busy) "上传中" else "更换封面", color = Ink.text, modifier = Modifier.clickable(enabled = !busy) { picker.launch("image/*") }.padding(vertical = 8.dp))
        val openingLines = openings.toList()
        val card = OwnCard(if (editing == "new" || editing.startsWith("draft-")) "" else editing, name, current?.author.orEmpty(), cover, description, personality, scenario, openingLines.firstOrNull { it.role == "assistant" && it.content.isNotBlank() }?.content.orEmpty(), systemPrompt, current?.voice.orEmpty(), tagsText.split(',', '，', '\n').map { it.trim() }.filter { it.isNotEmpty() }.distinct(), introduction = introduction, notes = notes, gallery = gallery.toList(), book = current?.book == true || lore.isNotEmpty(), bookName = bookName, bookSource = current?.bookSource.orEmpty(), bookDescription = bookDescription, bookScan = bookScan.toIntOrNull(), lore = lore.toList(), statusTemplate = statusTemplate, statusInitial = statusInitial, statusRules = statusRules, panels = panels.toList(), openings = openingLines, greetings = greetings.toList(), replies = replies.toList(), postHistory = postHistory, examples = examples, appearance = appearance, interactionSettings = interactionSettings)
        Text("导入角色卡", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy, onClick = import).padding(top = 8.dp))
        Text("导出角色卡", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy && name.isNotBlank()) { export(card) }.padding(vertical = 8.dp))
        Text(if (busy) "保存中" else "保存", color = Ink.text, modifier = Modifier.clickable(enabled = !busy) { save(card) }.padding(vertical = 12.dp))
        if (current != null) {
            Text("送审", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy) { submit(card) }.padding(bottom = 8.dp))
            Text("开聊", color = Ink.accent, modifier = Modifier.clickable { onChat(current.id, current.name) }.padding(bottom = 8.dp))
            Text("删除", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !busy) { confirmDelete = true })
        }
        state.notice?.let { Text(it, color = Ink.accent, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
        state.error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
    }
    if (confirmDelete && current != null) {
        Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { confirmDelete = false })
        Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
            Text("删除角色", color = Ink.text, fontSize = 18.sp)
            Text("删除「${current.name}」及它的收藏和关联会话？此操作无法撤销。", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp))
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("取消", color = Ink.muted, modifier = Modifier.clickable { confirmDelete = false }.padding(vertical = 8.dp))
                Text("删除角色", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !busy) {
                    confirmDelete = false
                    remove(current.id)
                }.padding(vertical = 8.dp))
            }
        }
    }
    }
}

private fun shareCard(context: android.content.Context, name: String, body: String) {
    val safe = name.replace(Regex("""[\\/:*?"<>|\s]+"""), "_").take(80).ifBlank { "角色卡.json" }
    val directory = java.io.File(context.cacheDir, "exports").apply { mkdirs() }
    val file = java.io.File(directory, if (safe.endsWith(".json")) safe else "$safe.json")
    file.writeText(body)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "application/json"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, file.name)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri(file.name, uri)
    }
    context.startActivity(Intent.createChooser(send, "导出角色卡").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
private fun SettingsForm(desk: AuthorDesk, busy: Boolean, error: String?, save: (String, String, String, String, Int, String, String, String, String, String, String, String, String, Int, String, String, String, Boolean, String, Int) -> Unit) {
    var nickname by rememberSaveable(desk.version) { mutableStateOf(desk.nickname) }
    var bio by rememberSaveable(desk.version) { mutableStateOf(desk.bio) }
    var gender by rememberSaveable(desk.version) { mutableStateOf(desk.gender) }
    var homeLayout by rememberSaveable(desk.version) { mutableStateOf(if (desk.homeLayout == "single") "single" else "double") }
    var theme by rememberSaveable(desk.version) { mutableStateOf(if (desk.theme == "light" || desk.theme == "system") desk.theme else "dark") }
    var showFloating by rememberSaveable(desk.version) { mutableStateOf(desk.showFloatingChat) }
    var floatingSize by rememberSaveable(desk.version) { mutableStateOf(if (desk.floatingSize == "small" || desk.floatingSize == "large") desk.floatingSize else "medium") }
    var floatingOpacity by rememberSaveable(desk.version) { mutableStateOf(desk.floatingOpacity.coerceIn(20, 100)) }
    var chatFontSize by rememberSaveable(desk.version) { mutableStateOf(desk.chatFontSize) }
    var chatFont by rememberSaveable(desk.version) { mutableStateOf(desk.chatFont) }
    var userBubble by rememberSaveable(desk.version) { mutableStateOf(desk.userBubble) }
    var assistantBubble by rememberSaveable(desk.version) { mutableStateOf(desk.assistantBubble) }
    var bubbleOpacity by rememberSaveable(desk.version) { mutableStateOf(desk.bubbleOpacity) }
    var chatBackground by rememberSaveable(desk.version) { mutableStateOf(desk.chatBackground) }
    var enterKey by rememberSaveable(desk.version) { mutableStateOf(desk.enterKey) }
    var persona by rememberSaveable(desk.version) { mutableStateOf(desk.persona) }
    var preset by rememberSaveable(desk.version) { mutableStateOf(desk.preset) }
    var model by rememberSaveable(desk.version) { mutableStateOf(desk.model) }
    var tokens by rememberSaveable(desk.version) { mutableStateOf(desk.maxTokens.toString()) }
    var blocked by rememberSaveable(desk.version) { mutableStateOf(desk.blockedTags.joinToString("\n")) }
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Field(nickname, { nickname = it.take(30) }, "称呼")
        Field(bio, { bio = it.take(500) }, "个人简介", 3)
        Text("${bio.length}/500", color = Ink.muted, fontSize = 12.sp)
        Text("性别", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        listOf("" to "未设置", "male" to "男", "female" to "女", "other" to "其他").forEach { (id, label) ->
            Text(label, color = if (gender == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { gender = id }.padding(vertical = 6.dp))
        }
        Text("主题", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        listOf("dark" to "深色", "light" to "浅色", "system" to "跟随系统").forEach { (id, label) ->
            Text(label, color = if (theme == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { theme = id }.padding(vertical = 6.dp))
        }
        Text(if (showFloating) "悬浮聊天按钮：显示" else "悬浮聊天按钮：隐藏", color = if (showFloating) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { showFloating = !showFloating }.padding(top = 12.dp, bottom = 6.dp))
        if (showFloating) {
            Text("按钮大小", color = Ink.muted, fontSize = 13.sp)
            listOf("small" to "小", "medium" to "中", "large" to "大").forEach { (id, label) ->
                Text(label, color = if (floatingSize == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { floatingSize = id }.padding(vertical = 6.dp))
            }
            Text("按钮不透明度 $floatingOpacity%", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("减淡", color = Ink.accent, modifier = Modifier.clickable { floatingOpacity = (floatingOpacity - 5).coerceAtLeast(20) }.padding(vertical = 6.dp))
                Text("加深", color = Ink.accent, modifier = Modifier.clickable { floatingOpacity = (floatingOpacity + 5).coerceAtMost(100) }.padding(vertical = 6.dp))
            }
        }
        Text("首页布局", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        listOf("double" to "双列", "single" to "单列").forEach { (id, label) ->
            Text(label, color = if (homeLayout == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { homeLayout = id }.padding(vertical = 6.dp))
        }
        Text("聊天字号", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        listOf("small" to "小", "medium" to "标准", "large" to "大", "xlarge" to "特大").forEach { (id, label) ->
            Text(label, color = if (chatFontSize == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { chatFontSize = id }.padding(vertical = 6.dp))
        }
        Text("聊天字体", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        listOf("system" to "系统默认", "serif" to "宋体", "kai" to "楷体").forEach { (id, label) ->
            Text(label, color = if (chatFont == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { chatFont = id }.padding(vertical = 6.dp))
        }
        Field(userBubble, { userBubble = it.take(7) }, "我的消息气泡，#rrggbb，留空恢复默认")
        Field(assistantBubble, { assistantBubble = it.take(7) }, "角色消息气泡，#rrggbb，留空恢复默认")
        Text("气泡不透明度 $bubbleOpacity%", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("减淡", color = Ink.accent, modifier = Modifier.clickable { bubbleOpacity = (bubbleOpacity - 5).coerceAtLeast(20) }.padding(vertical = 6.dp))
            Text("加深", color = Ink.accent, modifier = Modifier.clickable { bubbleOpacity = (bubbleOpacity + 5).coerceAtMost(100) }.padding(vertical = 6.dp))
        }
        Text("聊天背景", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        listOf("cover" to "当前角色", "site" to "默认壁纸", "plain" to "纯色").forEach { (id, label) ->
            Text(label, color = if (chatBackground == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { chatBackground = id }.padding(vertical = 6.dp))
        }
        Text("回车键", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        listOf("auto" to "自动（手机换行）", "send" to "回车发送", "newline" to "回车换行").forEach { (id, label) ->
            Text(label, color = if (enterKey == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { enterKey = id }.padding(vertical = 6.dp))
        }
        Field(persona, { persona = it.take(4000) }, "默认人设", 3)
        Text("没有单独设置的对话都用它。人设库在模型与预设里。", color = Ink.muted, fontSize = 12.sp)
        Field(preset, { preset = it.take(8000) }, "写作预设", 4)
        Text("对话模型", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        models.forEach { (id, label) ->
            Text(label, color = if (model == id) Ink.accent else Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { model = id }.padding(vertical = 6.dp))
        }
        Field(tokens, { tokens = it.filter(Char::isDigit).take(4) }, "最大回复长度")
        Field(blocked, { blocked = it.take(2200) }, "屏蔽标签，每行一个", 4)
        Text(if (busy) "保存中" else "保存", color = Ink.text, modifier = Modifier.clickable(enabled = !busy) {
            save(nickname, persona, preset, model, tokens.toIntOrNull() ?: desk.maxTokens, blocked, bio, gender, homeLayout, chatFontSize, chatFont, userBubble, assistantBubble, bubbleOpacity, chatBackground, enterKey, theme, showFloating, floatingSize, floatingOpacity)
        }.padding(vertical = 12.dp))
        error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp) }
    }
}

@Composable
private fun PresetForm(
    desk: AuthorDesk,
    busy: Boolean,
    error: String?,
    use: (String) -> Unit,
    add: (String, String) -> Unit,
    remove: (String) -> Unit,
    savePersona: (String, String, String) -> Unit,
    deletePersona: (String) -> Unit,
) {
    var personaId by rememberSaveable { mutableStateOf("") }
    var personaName by rememberSaveable { mutableStateOf("") }
    var personaBody by rememberSaveable { mutableStateOf("") }
    var editingPersona by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var content by rememberSaveable { mutableStateOf("") }
    var pending by remember { mutableStateOf<String?>(null) }
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Text("当前写作预设", color = Ink.muted, fontSize = 13.sp)
        Text(desk.preset.ifBlank { "还没有启用预设" }, color = Ink.text, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp))
        desk.presets.forEach { preset ->
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Text(preset.name, color = Ink.text, fontSize = 16.sp)
                Text(preset.content, color = Ink.muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("启用", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy) { use(preset.content) }.padding(vertical = 6.dp))
                    Text("删除", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !busy) { pending = "preset:${preset.id}" }.padding(vertical = 6.dp))
                }
            }
        }
        Field(name, { name = it.take(80) }, "预设名称")
        Field(content, { content = it.take(8000) }, "预设正文", 4)
        Text(if (busy) "保存中" else "加入并启用", color = Ink.text, modifier = Modifier.clickable(enabled = !busy && name.isNotBlank() && content.isNotBlank()) { add(name, content); name = ""; content = "" }.padding(vertical = 12.dp))
        Text("人设库 ${desk.personas.size}/30", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 18.dp))
        Text("告诉角色你希望在故事中扮演谁。对话里可以改用其中一个人设。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
        desk.personas.forEach { persona ->
            val used = desk.conversationPersonas.values.count { it == persona.id }
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Text(persona.name, color = Ink.text, fontSize = 16.sp)
                Text(persona.content.ifBlank { "还没有正文" }, color = Ink.muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                if (used > 0) Text("用于 $used 个对话", color = Ink.muted, fontSize = 12.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("编辑", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy) {
                        personaId = persona.id
                        personaName = persona.name
                        personaBody = persona.content
                        editingPersona = true
                    }.padding(vertical = 6.dp))
                    Text("删除", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !busy) { pending = "persona:${persona.id}" }.padding(vertical = 6.dp))
                }
            }
        }
        if (!editingPersona && desk.personas.size < 30) {
            Text("新建人设", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy) {
                personaId = ""
                personaName = ""
                personaBody = ""
                editingPersona = true
            }.padding(vertical = 8.dp))
        }
        if (editingPersona) {
            Field(personaName, { personaName = it.take(80) }, "人设名称")
            Field(personaBody, { personaBody = it.take(4000) }, "人设正文", 4)
            Text(if (busy) "保存中" else "保存人设", color = Ink.text, modifier = Modifier.clickable(enabled = !busy && personaName.isNotBlank()) {
                savePersona(personaId, personaName, personaBody)
                editingPersona = false
            }.padding(vertical = 8.dp))
            Text("取消", color = Ink.muted, modifier = Modifier.clickable { editingPersona = false }.padding(bottom = 8.dp))
        }
        error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp) }
    }
    pending?.let { key ->
        val preset = if (key.startsWith("preset:")) desk.presets.find { it.id == key.removePrefix("preset:") } else null
        val persona = if (key.startsWith("persona:")) desk.personas.find { it.id == key.removePrefix("persona:") } else null
        val used = persona?.let { item -> desk.conversationPersonas.values.count { it == item.id } } ?: 0
        Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { pending = null })
        Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
            Text(if (preset != null) "删除预设" else "删除人设", color = Ink.text, fontSize = 18.sp)
            Text(
                when {
                    preset != null -> "删除「${preset.name}」？" + if (preset.content == desk.preset) "当前对话预设仍会保留，已有会话不受影响。" else ""
                    persona != null -> "删除「${persona.name}」？" + if (used > 0) "正在使用它的 $used 个对话会改用默认人设。" else ""
                    else -> "这项已经不在列表里。"
                },
                color = Ink.muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("取消", color = Ink.muted, modifier = Modifier.clickable { pending = null }.padding(vertical = 8.dp))
                Text(if (preset != null) "删除预设" else "删除人设", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !busy && (preset != null || persona != null)) {
                    if (preset != null) remove(preset.id) else persona?.let { deletePersona(it.id) }
                    pending = null
                }.padding(vertical = 8.dp))
            }
        }
    }
    }
}

@Composable
private fun VoiceForm(desk: AuthorDesk, busy: Boolean, error: String?, setVoice: (String, String) -> Unit) {
    var cardId by rememberSaveable(desk.cards.firstOrNull()?.id) { mutableStateOf(desk.cards.first().id) }
    var playing by remember { mutableStateOf<String?>(null) }
    var previewError by remember { mutableStateOf<String?>(null) }
    val player = remember {
        MediaPlayer().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        }
    }
    DisposableEffect(player) {
        onDispose {
            runCatching {
                player.setOnPreparedListener(null)
                player.setOnCompletionListener(null)
                player.setOnErrorListener(null)
                player.release()
            }
        }
    }
    val card = desk.cards.find { it.id == cardId } ?: desk.cards.first()
    fun preview(id: String, url: String) {
        if (playing == id) {
            runCatching { player.reset() }
            playing = null
            return
        }
        previewError = null
        runCatching {
            player.reset()
            player.setDataSource(url)
            player.setOnPreparedListener {
                it.start()
                playing = id
            }
            player.setOnCompletionListener { playing = null }
            player.setOnErrorListener { _, _, _ ->
                playing = null
                previewError = "试听没有播出来"
                true
            }
            playing = id
            player.prepareAsync()
        }.onFailure {
            playing = null
            previewError = "试听没有播出来"
        }
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Text(card.name, color = Ink.text, fontSize = 18.sp)
            Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                desk.cards.forEach { item ->
                    Text(item.name, color = if (item.id == card.id) Ink.accent else Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { cardId = item.id })
                }
            }
            error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp)) }
            previewError?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp)) }
        }
        items(voices, key = { it.id }) { voice ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    voice.label,
                    color = if (card.voice.ifBlank { defaultVoice } == voice.id) Ink.accent else Ink.text,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f).clickable(enabled = !busy) { setVoice(card.id, voice.id) },
                )
                if (voice.preview != null) {
                    Text(if (playing == voice.id) "停止" else "试听", color = Ink.accent, modifier = Modifier.clickable { preview(voice.id, voice.preview) }.padding(start = 12.dp))
                }
            }
        }
    }
}

@Composable
private fun Heading(icon: String, title: String) {
    Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Mark(icon, size = 22.dp, color = Ink.accent)
        Text(title, color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(start = 10.dp))
    }
}

@Composable
private fun Waiting(text: String, retry: (() -> Unit)? = null) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = Ink.muted, modifier = if (retry == null) Modifier.padding(20.dp) else Modifier.clickable(onClick = retry).padding(20.dp))
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, hint: String, lines: Int = 1) {
    TextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        minLines = lines,
        placeholder = { Text(hint) },
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
}

private fun voiceLabel(id: String): String = voices.find { it.id == id }?.label ?: "晚灯 · 默认"

private fun panelPresets(): List<StudioPanel> = listOf(
    StudioPanel("status", "状态", listOf(StudioField("时间", "text", "未知"), StudioField("地点", "text", "未知"), StudioField("心情", "text", "平静"))),
    StudioPanel("relationship", "关系", listOf(StudioField("好感度", "meter", "20", "单轮变化不超过 10"), StudioField("关系阶段", "text", "陌生", "好感度 <30 陌生，30–59 熟人，60–84 暧昧，85+ 恋人"))),
    StudioPanel("inventory", "背包", listOf(StudioField("物品", "list", "", "获得或失去物品时更新，用「、」分隔"))),
    StudioPanel("profile", "角色信息", listOf(StudioField("姓名", "text", "未知"), StudioField("身份", "text", "未知"), StudioField("当前状态", "text", "平静", "一句话写角色此刻的身体和情绪状态"))),
    StudioPanel("outfit", "穿着", listOf(StudioField("上装", "text", "未知", "脱下、弄乱或更换时更新"), StudioField("下装", "text", "未知", "脱下、弄乱或更换时更新"), StudioField("内衣", "text", "未知", "脱下、弄乱或更换时更新"), StudioField("饰品", "list", "", "用「、」分隔"))),
    StudioPanel("mind", "心理", listOf(StudioField("情绪", "text", "平静"), StudioField("欲望", "meter", "10", "0–100，单轮变化不超过 15"), StudioField("对你的看法", "text", "还不了解", "随互动变化，一句话"))),
    StudioPanel("monologue", "内心独白", listOf(StudioField("独白", "text", "……", "角色此刻心里真实的一句话，用第一人称，不超过 60 字"))),
    StudioPanel("position", "体位", listOf(StudioField("姿势", "text", "无", "没有亲密接触时写「无」"), StudioField("接触部位", "text", "无"), StudioField("节奏", "text", "无", "例如：缓慢、加快、停下"))),
)

private fun sniffImage(bytes: ByteArray): String? {
    if (bytes.size >= 8 && bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() && bytes[2] == 0x4E.toByte()) return "image/png"
    if (bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() && bytes[2] == 0xFF.toByte()) return "image/jpeg"
    if (bytes.size >= 12 && String(bytes, 0, 4) == "RIFF" && String(bytes, 8, 4) == "WEBP") return "image/webp"
    if (bytes.size >= 6 && (String(bytes, 0, 6) == "GIF87a" || String(bytes, 0, 6) == "GIF89a")) return "image/gif"
    return null
}
