package top.xumeng.app.feature.generate

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.withTimeout
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
import android.util.Base64
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.GenerationDesk
import top.xumeng.app.core.network.GenerationQuote
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark
import java.io.File
import java.util.UUID

data class GenerateUi(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val desk: GenerationDesk? = null,
    val modelId: String = "",
    val quote: GenerationQuote? = null,
    val error: String? = null,
    val shelf: TemplateShelf? = null,
    val templates: Boolean = true,
    val kind: String = "image",
    val group: String = "",
    val templateId: String = "",
    val styleId: String = "photo",
    val referenceName: String = "",
    val previewKind: String = "",
    val previewPath: String = "",
    val posters: Map<String, String> = emptyMap(),
    val demos: Map<String, String> = emptyMap(),
    val assetJobId: String = "",
    val assetKind: String = "",
    val assetPath: String = "",
    val assetLoading: String = "",
)

class GenerateViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val posterLoads = mutableSetOf<String>()
    private val demoLoads = mutableSetOf<String>()
    private var accountId: String? = null
    private var referenceImage: String = ""
    private val mutable = MutableStateFlow(GenerateUi())
    val state: StateFlow<GenerateUi> = mutable.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            mutable.update { it.copy(loading = true, error = null) }
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val id = accountId ?: backend.accountId().also { accountId = it }
                    backend.generationDesk(id)
                }
            }
            loaded.fold(
                onSuccess = { desk ->
                    mutable.update { it.copy(loading = false, desk = desk, modelId = it.modelId.ifBlank { desk.models.firstOrNull()?.id.orEmpty() }, quote = null) }
                },
                onFailure = { error -> mutable.update { it.copy(loading = false, error = error.message ?: "生成服务没有连上") } },
            )
        }
    }

    fun selectModel(id: String) { mutable.update { it.copy(modelId = id, quote = null) } }

    fun loadShelf(assets: android.content.res.AssetManager) {
        if (mutable.value.shelf != null) return
        val shelf = runCatching { TemplateCatalog.load(assets) }.getOrNull() ?: return
        mutable.update { it.copy(shelf = shelf, templateId = it.templateId.ifBlank { shelf.stills.firstOrNull()?.id.orEmpty() }) }
    }

    fun showTemplates(enabled: Boolean) { mutable.update { it.copy(templates = enabled, quote = null, error = null) } }

    fun pickKind(kind: String) {
        val shelf = mutable.value.shelf ?: return
        val first = shelf.visible(kind, "", "").firstOrNull()?.id.orEmpty()
        mutable.update { it.copy(kind = kind, group = "", templateId = first, quote = null, error = null) }
    }

    fun pickGroup(group: String) { mutable.update { it.copy(group = group) } }

    fun pickTemplate(id: String) {
        val template = mutable.value.shelf?.find(id) ?: return
        val kind = if (template.kind == "video") "video" else "image"
        mutable.update { it.copy(templateId = id, kind = kind, quote = null, error = null) }
    }

    fun ensurePoster(id: String, cacheDir: File) {
        if (id.isBlank() || mutable.value.posters.containsKey(id)) return
        val template = mutable.value.shelf?.find(id) ?: return
        val remote = posterPath(template)
        if (remote == null) {
            mutable.update { it.copy(posters = it.posters + (id to "")) }
            return
        }
        synchronized(posterLoads) { if (!posterLoads.add(id)) return }
        viewModelScope.launch {
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val file = File(cacheDir, "template-poster-$id.webp")
                    if (file.length() <= 0L) file.writeBytes(backend.publicAsset(remote))
                    file.absolutePath
                }
            }
            synchronized(posterLoads) { posterLoads.remove(id) }
            loaded.onSuccess { path -> mutable.update { it.copy(posters = it.posters + (id to path)) } }
        }
    }

    fun ensureDemo(id: String, cacheDir: File) {
        if (id.isBlank() || mutable.value.demos.containsKey(id)) return
        val template = mutable.value.shelf?.find(id) ?: return
        val remote = demoPath(template) ?: run {
            mutable.update { it.copy(demos = it.demos + (id to "")) }
            return
        }
        synchronized(demoLoads) { if (!demoLoads.add(id)) return }
        viewModelScope.launch {
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val file = File(cacheDir, "template-demo-$id.mp4")
                    if (file.length() <= 0L) file.writeBytes(backend.publicMedia(remote))
                    file.absolutePath
                }
            }
            synchronized(demoLoads) { demoLoads.remove(id) }
            loaded.onSuccess { path -> mutable.update { it.copy(demos = it.demos + (id to path)) } }
        }
    }

    fun pickStyle(id: String) { mutable.update { it.copy(styleId = id) } }

    fun removeJob(id: String) {
        val owner = accountId ?: return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.deleteGeneration(owner, id) } }
            done.fold(
                onSuccess = {
                    mutable.update { current ->
                        if (current.assetJobId == id) current.copy(assetJobId = "", assetKind = "", assetPath = "") else current
                    }
                    refresh()
                },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "任务没有删除") } },
            )
        }
    }

    fun openAsset(jobId: String, kind: String, url: String?, cacheDir: File) {
        if (url.isNullOrBlank()) return
        viewModelScope.launch {
            mutable.update { it.copy(assetLoading = jobId, error = null) }
            val saved = runCatching {
                withContext(Dispatchers.IO) {
                    val bytes = backend.generationAsset(url)
                    val file = File(cacheDir, "generation-$jobId.${if (kind == "video") "mp4" else "png"}")
                    file.writeBytes(bytes)
                    file.absolutePath
                }
            }
            saved.fold(
                onSuccess = { path -> mutable.update { it.copy(assetLoading = "", assetJobId = jobId, assetKind = kind, assetPath = path) } },
                onFailure = { error -> mutable.update { it.copy(assetLoading = "", error = error.message ?: "结果没有取回") } },
            )
        }
    }

    fun attachUri(resolver: android.content.ContentResolver, uri: Uri) {
        viewModelScope.launch {
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val mime = resolver.getType(uri)
                    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw java.io.IOException("参考图没有读到")
                    bytes to mime
                }
            }
            loaded.fold(
                onSuccess = { (bytes, mime) -> attachReference(bytes, "参考图", mime) },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "参考图没有读到") } },
            )
        }
    }

    fun attachReference(bytes: ByteArray, name: String, mime: String?) {
        if (mime != null && mime !in setOf("image/png", "image/jpeg", "image/webp")) {
            mutable.update { it.copy(error = "参考图仅支持 PNG、JPEG 或 WebP") }
            return
        }
        if (bytes.isEmpty() || bytes.size > 8_000_000) {
            mutable.update { it.copy(error = "参考图太大或是空的") }
            return
        }
        referenceImage = Base64.encodeToString(bytes, Base64.NO_WRAP)
        mutable.update { it.copy(referenceName = name.ifBlank { "参考图" }, error = null) }
    }

    fun renderTemplate(note: String, cacheDir: File) {
        val current = mutable.value
        val template = current.shelf?.find(current.templateId) ?: return
        if (referenceImage.isBlank() && !template.free) {
            mutable.update { it.copy(error = "请先上传参考图") }
            return
        }
        val prompt = runCatching { compileTemplate(template, note) }.getOrElse { error ->
            mutable.update { it.copy(error = error.message ?: "模板没有填完") }
            return
        }
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val rendered = runCatching {
                withContext(Dispatchers.IO) {
                    val bytes = if (template.kind == "video") backend.studioVideo(template.id, prompt, referenceImage)
                    else backend.studioStill(template.id, prompt, referenceImage, current.styleId)
                    val file = File(cacheDir, if (template.kind == "video") "studio-preview.mp4" else "studio-preview.png")
                    file.writeBytes(bytes)
                    file.absolutePath
                }
            }
            rendered.fold(
                onSuccess = { path -> mutable.update { it.copy(busy = false, previewKind = template.kind, previewPath = path, error = null) } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "生成没有完成") } },
            )
        }
    }

    fun quote(prompt: String, aspect: String) {
        val owner = accountId ?: return
        val model = mutable.value.desk?.models?.find { it.id == mutable.value.modelId } ?: return
        val text = prompt.trim()
        if (text.length < 2) {
            mutable.update { it.copy(error = "先写画面") }
            return
        }
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null, quote = null) }
            val duration = if (model.kind == "video") model.durations.firstOrNull() else null
            val result = runCatching { withContext(Dispatchers.IO) { backend.quoteGeneration(owner, model.kind, model.id, text, aspect, duration) } }
            result.fold(
                onSuccess = { quote -> mutable.update { it.copy(busy = false, quote = quote) } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "没有拿到报价") } },
            )
        }
    }

    fun confirm(prompt: String, aspect: String) {
        val owner = accountId ?: return
        val quote = mutable.value.quote ?: return
        val model = mutable.value.desk?.models?.find { it.id == mutable.value.modelId } ?: return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val duration = if (model.kind == "video") model.durations.firstOrNull() else null
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    backend.createGeneration(owner, model.kind, model.id, prompt.trim(), aspect, duration, UUID.randomUUID().toString(), quote.max)
                }
            }
            result.fold(
                onSuccess = { refresh() },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "任务没有提交") } },
            )
        }
    }
}

@Composable
fun GenerateScreen() {
    val model = viewModel<GenerateViewModel>()
    val state by model.state.collectAsState()
    var prompt by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var aspect by rememberSaveable { mutableStateOf("3:4") }
    var browsing by rememberSaveable { mutableStateOf(true) }
    var query by rememberSaveable { mutableStateOf("") }
    var videoGroup by rememberSaveable { mutableStateOf("") }
    var imageGroup by rememberSaveable { mutableStateOf("") }
    var previewId by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) model.attachUri(context.contentResolver, uri)
    }
    LaunchedEffect(Unit) { model.loadShelf(context.assets) }
    val desk = state.desk
    Column(Modifier.fillMaxSize().background(Ink.background).imePadding()) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Mark("sparkles", size = 22.dp, color = Ink.accent)
            Text("生成", color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(start = 10.dp))
        }
        when {
            state.loading && desk == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("正在读取生成", color = Ink.muted) }
            desk == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(state.error ?: "生成服务没有连上", color = Ink.muted, modifier = Modifier.clickable { model.refresh() }.padding(20.dp))
            }
            else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("模板", color = if (state.templates) Ink.accent else Ink.muted, modifier = Modifier.clickable { model.showTemplates(true); browsing = true; previewId = null }.padding(vertical = 8.dp))
                        Text("直接写", color = if (!state.templates) Ink.accent else Ink.muted, modifier = Modifier.clickable { model.showTemplates(false); previewId = null }.padding(vertical = 8.dp))
                    }
                }
                if (state.templates && browsing) {
                    templateLibrary(state, query, { query = it.take(120) }, videoGroup, imageGroup, { videoGroup = it }, { imageGroup = it }, previewId, { previewId = it }, { id ->
                        previewId = null
                        model.pickTemplate(id)
                        browsing = false
                    })
                } else if (state.templates) {
                    item {
                        TemplateCreate(state, note, { note = it.take(1000) }, { picker.launch("image/*") }, { browsing = true }) { model.renderTemplate(note, context.cacheDir) }
                    }
                }
                if (!state.templates) item {
                    if (!desk.enabled) Text("生成通道暂时关闭", color = Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        desk.models.forEach { item ->
                            Text(item.label, color = if (item.id == state.modelId) Ink.accent else Ink.muted, modifier = Modifier.clickable { model.selectModel(item.id) }.padding(vertical = 8.dp))
                        }
                    }
                    TextField(
                        value = prompt,
                        onValueChange = { prompt = it.take(4000); model.selectModel(state.modelId) },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        minLines = 4,
                        placeholder = { Text("写你想生成的画面") },
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
                    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        listOf("1:1", "3:4", "9:16", "16:9").forEach { ratio ->
                            Text(ratio, color = if (aspect == ratio) Ink.accent else Ink.muted, modifier = Modifier.clickable { aspect = ratio }.padding(vertical = 8.dp))
                        }
                    }
                    val quote = state.quote
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text(if (state.busy) "处理中" else "查看报价", color = Ink.text, modifier = Modifier.clickable(enabled = !state.busy && desk.enabled) { model.quote(prompt, aspect) }.padding(vertical = 10.dp))
                        if (quote != null) Text("确认 · 预留 ${quote.max} Credit", color = Ink.accent, modifier = Modifier.clickable(enabled = !state.busy) { model.confirm(prompt, aspect) }.padding(vertical = 10.dp))
                    }
                    if (quote != null) Text("预计 ${quote.estimated} Credit，最多预留 ${quote.max}", color = Ink.muted, fontSize = 13.sp)
                }
                item {
                    state.error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }
                    Text("任务", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
                }
                items(desk.jobs, key = { it.id }) { job ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                        Text(job.prompt, color = Ink.text, fontSize = 14.sp, maxLines = 2)
                        Text("${jobStatus(job.status)} · ${if (job.status == "ready") "已扣 ${job.charged}" else "预留 ${job.reserved}"} Credit", color = Ink.muted, fontSize = 12.sp)
                        Text("删除", color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.clickable(enabled = !state.busy) { model.removeJob(job.id) }.padding(top = 6.dp))
                        if (job.status == "ready" && !job.asset.isNullOrBlank()) {
                            Text(
                                if (state.assetLoading == job.id) "正在取回" else "查看结果",
                                color = Ink.accent,
                                modifier = Modifier.clickable(enabled = state.assetLoading != job.id) { model.openAsset(job.id, job.kind, job.asset, context.cacheDir) }.padding(top = 6.dp),
                            )
                        }
                        if (state.assetJobId == job.id && state.assetPath.isNotBlank()) Preview(state.assetKind, state.assetPath)
                    }
                }
            }
        }
    }
}

private fun LazyListScope.templateLibrary(
    state: GenerateUi,
    query: String,
    onQuery: (String) -> Unit,
    videoGroup: String,
    imageGroup: String,
    onVideoGroup: (String) -> Unit,
    onImageGroup: (String) -> Unit,
    previewId: String?,
    onPreview: (String?) -> Unit,
    onPick: (String) -> Unit,
) {
    val shelf = state.shelf
    if (shelf == null) {
        item { Text("正在读取模板", color = Ink.muted, modifier = Modifier.padding(vertical = 8.dp)) }
        return
    }
    val videoPool = shelf.visible("video", "", query)
    val imagePool = shelf.visible("image", "", query).filter { !it.free }
    val free = shelf.visible("image", "", query).find { it.free }
    val videoGroups = shelf.groups.filter { group -> videoPool.any { it.group == group.id } }
    val imageGroups = shelf.groups.filter { group -> imagePool.any { it.group == group.id } }
    val activeVideo = videoGroup.takeIf { id -> videoGroups.any { it.id == id } }.orEmpty()
    val activeImage = imageGroup.takeIf { id -> imageGroups.any { it.id == id } }.orEmpty()
    val videos = videoPool.filter { activeVideo.isEmpty() || it.group == activeVideo }
    val images = imagePool.filter { activeImage.isEmpty() || it.group == activeImage }
    item {
        TextField(
            value = query,
            onValueChange = onQuery,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            singleLine = true,
            placeholder = { Text("搜索动作或静帧") },
            colors = shelfFields(),
        )
        if (query.isNotBlank()) Text("清除", color = Ink.muted, modifier = Modifier.clickable { onQuery("") }.padding(bottom = 8.dp))
    }
    if (videoPool.isEmpty() && imagePool.isEmpty() && free == null) {
        item {
            Text("没有找到匹配的模板", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 12.dp))
            Text("换个关键词，或清除搜索。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
            Text("清除", color = Ink.accent, modifier = Modifier.clickable { onQuery("") }.padding(bottom = 12.dp))
        }
        return
    }
    if (videoPool.isNotEmpty()) {
        item {
            Text("生视频", color = Ink.text, fontSize = 18.sp)
            Text("选一个动作，再上传你的参考图。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            Text("${videos.size}", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp))
            GroupChips(videoGroups, videoPool, activeVideo, onVideoGroup)
        }
        posterRows("video", videos, state, previewId, onPreview, onPick)
    }
    if (imagePool.isNotEmpty() || free != null) {
        item {
            Text("生图", color = Ink.text, fontSize = 18.sp, modifier = Modifier.padding(top = 16.dp))
            Text("选一张清楚的模板图。生成时再配风格和参考图。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            Text("${images.size}", color = Ink.muted, fontSize = 12.sp)
            if (free != null) {
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = !state.busy) { onPick(free.id) }.padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Mark("sparkles", size = 20.dp, color = Ink.accent)
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Text(free.label, color = Ink.text, fontSize = 15.sp)
                        Text("不选模板，上传参考图，写关键词出图", color = Ink.muted, fontSize = 12.sp)
                    }
                }
            }
            if (imagePool.isNotEmpty()) GroupChips(imageGroups, imagePool, activeImage, onImageGroup)
        }
        posterRows("image", images, state, previewId, onPreview, onPick)
    }
}

private fun LazyListScope.posterRows(
    prefix: String,
    templates: List<ShelfTemplate>,
    state: GenerateUi,
    previewId: String?,
    onPreview: (String?) -> Unit,
    onPick: (String) -> Unit,
) {
    templates.chunked(3).forEach { row ->
        item(key = "$prefix-${row.first().id}") {
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { template ->
                    PosterCard(
                        template,
                        state.posters[template.id],
                        playing = previewId == template.id,
                        demoPath = state.demos[template.id],
                        busy = state.busy,
                        onPick = { onPick(template.id) },
                        onPreview = { active -> onPreview(if (active) template.id else null) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun GroupChips(groups: List<ShelfGroup>, pool: List<ShelfTemplate>, selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("全部", color = if (selected.isEmpty()) Ink.accent else Ink.muted, modifier = Modifier.clickable { onSelect("") }.padding(vertical = 4.dp))
        groups.forEach { group ->
            val count = pool.count { it.group == group.id }
            Text("${group.label} $count", color = if (selected == group.id) Ink.accent else Ink.muted, modifier = Modifier.clickable { onSelect(group.id) }.padding(vertical = 4.dp))
        }
    }
}

@Composable
private fun TemplateCreate(state: GenerateUi, note: String, onNote: (String) -> Unit, pickImage: () -> Unit, back: () -> Unit, render: () -> Unit) {
    val shelf = state.shelf
    val selected = shelf?.find(state.templateId)
    val model = viewModel<GenerateViewModel>()
    val context = LocalContext.current
    LaunchedEffect(state.templateId, shelf) { model.ensurePoster(state.templateId, context.cacheDir) }
    Text("换模板", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.busy, onClick = back).padding(vertical = 8.dp))
    Text(if (selected?.kind == "video") "视频" else "图片", color = Ink.muted, fontSize = 12.sp)
    Text(selected?.label ?: "先选一个模板", color = Ink.text, fontSize = 22.sp)
    val poster = rememberPoster(state.posters[selected?.id])
    if (poster != null) Image(poster, contentDescription = selected?.label, modifier = Modifier.fillMaxWidth().height(220.dp).padding(top = 8.dp), contentScale = ContentScale.Fit)
    Text(selected?.frame?.ifBlank { "上传参考图，再写关键词。" } ?: "上传参考图，再写关键词。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
    if (selected?.kind != "video" && shelf != null) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            shelf.styles.forEach { style ->
                Text(style.label, color = if (style.id == state.styleId) Ink.accent else Ink.muted, modifier = Modifier.clickable { model.pickStyle(style.id) }.padding(vertical = 8.dp))
            }
        }
    }
    TextField(
        value = note,
        onValueChange = onNote,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        minLines = 2,
        placeholder = { Text(if (selected?.free == true) "关键词" else "补充要求，可以留空") },
        colors = shelfFields(),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(state.referenceName.ifBlank { "上传参考图" }, color = Ink.text, modifier = Modifier.clickable(onClick = pickImage).padding(vertical = 10.dp))
        val label = when {
            state.busy -> "处理中"
            selected?.kind == "video" -> "确认生成视频"
            else -> "确认出图 · 50 Credit"
        }
        Text(label, color = Ink.accent, modifier = Modifier.clickable(enabled = !state.busy, onClick = render).padding(vertical = 10.dp))
    }
    Preview(state.previewKind, state.previewPath)
}

@Composable
private fun shelfFields() = TextFieldDefaults.colors(
    focusedContainerColor = Ink.surface,
    unfocusedContainerColor = Ink.surface,
    focusedTextColor = Ink.text,
    unfocusedTextColor = Ink.text,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
    cursorColor = Ink.accent,
)

@Composable
private fun rememberPoster(path: String?): ImageBitmap? {
    val image by produceState<ImageBitmap?>(null, path) {
        value = if (path.isNullOrBlank()) null else withContext(Dispatchers.IO) { BitmapFactory.decodeFile(path)?.asImageBitmap() }
    }
    return image
}

@Composable
private fun PosterCard(
    item: ShelfTemplate,
    path: String?,
    playing: Boolean,
    demoPath: String?,
    busy: Boolean,
    onPick: () -> Unit,
    onPreview: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val poster = rememberPoster(path)
    val model = viewModel<GenerateViewModel>()
    val context = LocalContext.current
    LaunchedEffect(item.id) { model.ensurePoster(item.id, context.cacheDir) }
    LaunchedEffect(playing) { if (playing) model.ensureDemo(item.id, context.cacheDir) }
    Box(
        modifier
            .aspectRatio(3f / 4f)
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, if (playing) Ink.accent else Color.Transparent, RoundedCornerShape(8.dp))
            .pointerInput(item.id, busy) {
                awaitEachGesture {
                    awaitFirstDown()
                    val up = try {
                        withTimeout(viewConfiguration.longPressTimeoutMillis) { waitForUpOrCancellation() }
                    } catch (_: kotlinx.coroutines.TimeoutCancellationException) {
                        null
                    }
                    if (up != null) {
                        if (!busy) onPick()
                    } else if (!busy && item.id.startsWith("h3-")) {
                        onPreview(true)
                        try {
                            waitForUpOrCancellation()
                        } finally {
                            onPreview(false)
                        }
                    }
                }
            },
    ) {
        if (poster != null) {
            Image(poster, contentDescription = item.label, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            Box(Modifier.fillMaxSize().background(Ink.surface), contentAlignment = Alignment.Center) {
                Text(item.label, color = Ink.muted, fontSize = 11.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
        if (playing && !demoPath.isNullOrBlank()) DemoVideo(demoPath)
        Box(Modifier.fillMaxWidth().height(56.dp).background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent))))
        Text(item.label, color = Ink.text, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(8.dp))
    }
}

@Composable
private fun DemoVideo(path: String) {
    val context = LocalContext.current
    val player = remember(path) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(Uri.fromFile(File(path))))
            repeatMode = Player.REPEAT_MODE_ONE
            volume = 0f
            playWhenReady = true
            prepare()
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(
        factory = { viewContext ->
            PlayerView(viewContext).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                this.player = player
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun Preview(kind: String, path: String) {
    if (path.isBlank()) return
    if (kind == "image") {
        val bitmap = remember(path) { BitmapFactory.decodeFile(path)?.asImageBitmap() }
        if (bitmap != null) Image(bitmap, contentDescription = "生成结果", modifier = Modifier.fillMaxWidth().height(420.dp).padding(top = 8.dp), contentScale = ContentScale.Fit)
    } else {
        val context = LocalContext.current
        val player = remember(path) {
            ExoPlayer.Builder(context).build().apply {
                setMediaItem(MediaItem.fromUri(Uri.fromFile(File(path))))
                prepare()
                playWhenReady = true
            }
        }
        DisposableEffect(player) { onDispose { player.release() } }
        AndroidView(
            factory = { viewContext -> PlayerView(viewContext).apply { this.player = player } },
            modifier = Modifier.fillMaxWidth().height(420.dp).padding(top = 8.dp),
        )
    }
}

private fun jobStatus(status: String) = when (status) {
    "pending" -> "已提交"
    "processing" -> "生成中"
    "ready" -> "已完成"
    "failed" -> "未完成"
    else -> "等待核对"
}
