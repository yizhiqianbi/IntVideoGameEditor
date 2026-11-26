package top.xumeng.app.feature.chat

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import android.graphics.Typeface
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.content.ClipData
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import androidx.lifecycle.viewmodel.compose.viewModel
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.Line
import top.xumeng.app.core.network.Talk
import top.xumeng.app.core.network.RemoteImage
import top.xumeng.app.shell.ChatFocus
import top.xumeng.app.shell.Ink

@Composable
fun ChatScreen(focus: ChatFocus?, onFocusConsumed: () -> Unit, onThreadChanged: (Boolean) -> Unit) {
    val model = viewModel<ChatViewModel>()
    val state by model.state.collectAsState()
    LaunchedEffect(Unit) { model.syncDisplay() }
    LaunchedEffect(focus) {
        val pending = focus ?: return@LaunchedEffect
        model.openCharacter(pending.id, pending.name, pending.opening, pending.fresh)
        onFocusConsumed()
    }
    LaunchedEffect(state.thread) { onThreadChanged(state.thread != null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
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
                    if (total > 2_000_000) throw java.io.IOException("会话文件不能超过 2 MB。")
                    buffer.write(chunk, 0, count)
                }
                buffer.toString(Charsets.UTF_8.name())
            } ?: throw java.io.IOException("导入失败。")
        }
        text.fold(onSuccess = model::importArchive, onFailure = { model.report(it.message ?: "导入失败。") })
    }
    if (state.thread == null) TalkList(state, model::refresh, model::openTalk, model::deleteTalk) { picker.launch("*/*") }
    else Thread(state, model::send, model::stop, model::consumeComposer, model::prepareEdit, model::regenerate, model::suggest, model::rename, model::setClock, model::branch, {
        model.export { name, json ->
            runCatching { shareArchive(context, name, json) }.onFailure { model.report(it.message ?: "会话存档导出失败，请重试。") }
        }
    }, model::deleteTalk, model::closeThread, model::saveMemory, model::clearMemory, model::saveThreadPersona, model::loadPersonas, model::saveMessage, model::regenerateMessage, model::generateMedia, model::reloadMedia)
}

@Composable
private fun TalkList(state: ChatUi, refresh: () -> Unit, open: (String) -> Unit, remove: (String) -> Unit, import: () -> Unit) {
    var deleting by remember { mutableStateOf<Talk?>(null) }
    Box(Modifier.fillMaxSize().background(Ink.background)) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("聊天", color = Ink.text, fontSize = 22.sp, modifier = Modifier.weight(1f))
            Text(if (state.importing) "正在导入" else "导入会话", color = if (state.importing) Ink.muted else Ink.accent, fontSize = 14.sp, modifier = Modifier.clickable(enabled = !state.importing, onClick = import).padding(end = 12.dp))
            Text(state.accountLabel, color = Ink.muted, fontSize = 13.sp)
        }
        state.notice?.let { Text(it, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
        if (state.error != null && state.talks.isNotEmpty()) Text(state.error, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        when {
            state.loading && state.talks.isEmpty() -> Center("正在读取对话")
            state.error != null && state.talks.isEmpty() -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text(state.error, color = Ink.muted, fontSize = 15.sp)
                Text("重试", color = Ink.text, modifier = Modifier.clickable(onClick = refresh).padding(12.dp))
            }
            state.talks.isEmpty() -> Center("还没有对话。从广场点一个角色开始。")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(state.talks, key = { it.id }) { talk ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).clickable { open(talk.id) }) {
                            Text(talk.title, color = Ink.text, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val preview = talk.lines.lastOrNull()?.text.orEmpty()
                            if (preview.isNotBlank()) Text(preview, color = Ink.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text("删除", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.clickable { deleting = talk }.padding(start = 12.dp))
                    }
                    Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp).background(Ink.line).padding(top = 1.dp))
                }
            }
        }
    }
    deleting?.let { talk ->
        DeleteTalkDialog(talk.title, talk.lines.size, onCancel = { deleting = null }) {
            remove(talk.id)
            deleting = null
        }
    }
    }
}

@Composable
private fun Thread(
    state: ChatUi,
    send: (String) -> Unit,
    stop: () -> Unit,
    consumeComposer: () -> Unit,
    prepareEdit: () -> String?,
    regenerate: () -> Unit,
    suggest: () -> Unit,
    rename: (String) -> Unit,
    setClock: (String) -> Unit,
    branch: () -> Unit,
    export: () -> Unit,
    remove: (String) -> Unit,
    close: () -> Unit,
    saveMemory: (String, String, String, String, String, String, String) -> Unit,
    clearMemory: (String) -> Unit,
    savePersona: (String, String, String) -> Unit,
    loadPersonas: () -> Unit,
    saveMessage: (String, String) -> Unit,
    regenerateMessage: (String) -> Unit,
    generateMedia: (String, String, java.io.File, Boolean) -> Unit,
    reloadMedia: () -> Unit,
) {
    val thread = state.thread ?: return
    val context = LocalContext.current
    val list = rememberLazyListState()
    var text by remember(thread.id) { mutableStateOf("") }
    LaunchedEffect(state.composer) {
        val restored = state.composer ?: return@LaunchedEffect
        text = restored
        consumeComposer()
    }
    var renaming by remember(thread.id) { mutableStateOf(false) }
    var memoryOpen by remember(thread.id) { mutableStateOf(false) }
    var personaOpen by remember(thread.id) { mutableStateOf(false) }
    var name by remember(thread.id) { mutableStateOf(thread.title) }
    var deleting by remember(thread.id) { mutableStateOf(false) }
    LaunchedEffect(thread.lines.size, state.draftReply) {
        val last = thread.lines.size + if (state.draftReply.isNotEmpty()) 1 else 0
        if (last > 0) list.scrollToItem(last - 1)
    }
    Box(Modifier.fillMaxSize().background(Ink.background).imePadding()) {
        if (state.chatBackground == "cover" && state.cover.isNotBlank()) {
            RemoteImage(BuildConfig.WEB_ORIGIN, state.cover, null, Modifier.fillMaxSize())
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        listOf(
                            Color(0x780C060E),
                            Color(0x8A0C060E),
                            Color(0xBD0C060E),
                        ),
                    ),
                ),
            )
        }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("返回", color = Ink.muted, modifier = Modifier.clickable(onClick = close).padding(12.dp))
            Text(thread.title, color = Ink.text, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (thread.lines.any { it.role == "user" }) {
                Text("改上一句", color = if (state.sending) Ink.muted else Ink.accent, modifier = Modifier.clickable(enabled = !state.sending) { prepareEdit()?.let { text = it } }.padding(8.dp))
            }
            if (thread.lines.lastOrNull()?.role == "assistant") {
                Text("重写", color = if (state.sending) Ink.muted else Ink.accent, modifier = Modifier.clickable(enabled = !state.sending, onClick = regenerate).padding(8.dp))
            }
            Text(if (thread.clock == "realtime") "现实时间" else "剧情时间", color = Ink.accent, modifier = Modifier.clickable(enabled = !state.sending) {
                setClock(if (thread.clock == "realtime") "story" else "realtime")
            }.padding(8.dp))
            Text("改名", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.sending) { renaming = !renaming }.padding(8.dp))
            Text("删除", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.sending) { deleting = true }.padding(8.dp))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("复制分支", color = if (state.sending) Ink.muted else Ink.accent, modifier = Modifier.clickable(enabled = !state.sending, onClick = branch).padding(vertical = 4.dp))
            Text("导出", color = if (state.sending) Ink.muted else Ink.accent, modifier = Modifier.clickable(enabled = !state.sending, onClick = export).padding(vertical = 4.dp))
            Text(if (memoryOpen) "收起记忆" else "剧情记忆", color = Ink.accent, modifier = Modifier.clickable { memoryOpen = !memoryOpen }.padding(vertical = 4.dp))
            Text(if (personaOpen) "收起人设" else "人设", color = Ink.accent, modifier = Modifier.clickable {
                personaOpen = !personaOpen
                if (personaOpen) loadPersonas()
            }.padding(vertical = 4.dp))
        }
        if (memoryOpen) MemoryEditor(thread, state.sending, saveMemory, clearMemory)
        if (personaOpen) PersonaEditor(state, state.sending, savePersona)
        if (renaming) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextField(
                    value = name,
                    onValueChange = { name = it.take(80) },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
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
                Text("保存", color = Ink.text, modifier = Modifier.clickable { rename(name); renaming = false }.padding(12.dp))
            }
        }
        if (state.chrome.sections.isNotEmpty() || state.chrome.panels.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().heightIn(max = 168.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
                state.chrome.sections.forEach { section -> StatusBlock(section) }
                state.chrome.panels.forEach { section -> StatusBlock(section) }
            }
        }
        LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(thread.lines, key = { it.id }) { line ->
                val index = thread.lines.indexOfFirst { it.id == line.id }
                val canRegenerate = line.role == "assistant" && thread.lines.take(index).any { it.role == "user" }
                val stored = line.id.isNotBlank() && line.id != "draft" && line.id != "${thread.id}-$index"
                Bubble(line, state.chrome.labels, state.sending, canRegenerate, state.chatFontSize, state.chatFont, state.userBubble, state.assistantBubble, state.bubbleOpacity, openingTag(thread.opening, index, line), saveMessage, regenerateMessage, if (line.role == "assistant" && stored) lineMedia(state, line) else null, { kind, again -> generateMedia(line.id, kind, context.cacheDir, again) }) { reloadMedia() }
            }
            if (state.draftReply.isNotEmpty()) item { Bubble(Line("draft", "assistant", state.draftReply), state.chrome.labels, true, false, state.chatFontSize, state.chatFont, state.userBubble, state.assistantBubble, state.bubbleOpacity, null, { _, _ -> }, { _ -> }) }
        }
        if (!state.sending && thread.lines.none { it.role == "user" }) {
            Text("随机开局", color = Ink.accent, fontSize = 13.sp, modifier = Modifier.clickable { send("请随机生成我的身份和起始地点，从第一场事件开始。") }.padding(horizontal = 16.dp, vertical = 4.dp))
            state.quickReplies.forEach { reply ->
                Text(reply, color = Ink.text, fontSize = 13.sp, modifier = Modifier.clickable { send(reply) }.padding(horizontal = 16.dp, vertical = 4.dp))
            }
        }
        if (thread.lines.lastOrNull()?.role == "assistant") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(if (state.suggesting) "正在想下一步…" else "帮我想想", color = if (state.suggesting || state.sending) Ink.muted else Ink.accent, modifier = Modifier.clickable(enabled = !state.suggesting && !state.sending, onClick = suggest).padding(vertical = 6.dp))
                if (state.suggestions.isNotEmpty()) {
                    Text("换一组", color = if (state.suggesting || state.sending) Ink.muted else Ink.accent, modifier = Modifier.clickable(enabled = !state.suggesting && !state.sending, onClick = suggest).padding(vertical = 6.dp))
                }
            }
            state.suggestions.forEach { option ->
                Column(Modifier.fillMaxWidth().clickable(enabled = !state.sending && !state.suggesting) { send(option.reply) }.padding(horizontal = 16.dp, vertical = 4.dp)) {
                    Text("${option.direction} · ${option.title}", color = Ink.muted, fontSize = 12.sp)
                    Text(option.reply, color = Ink.text, fontSize = 14.sp)
                }
            }
        }
        state.notice?.let { Text(it, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
        if (state.error != null) Text(state.error, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp))
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            val enterSends = state.enterKey == "send"
            TextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("说点什么") },
                maxLines = 6,
                keyboardOptions = KeyboardOptions(imeAction = if (enterSends) ImeAction.Send else ImeAction.Default),
                keyboardActions = KeyboardActions(onSend = {
                    if (state.sending) return@KeyboardActions
                    val value = text
                    text = ""
                    send(value)
                }),
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
            Text(
                if (state.sending) "停止" else "发送",
                color = if (state.sending) Ink.accent else Ink.text,
                modifier = Modifier.clickable {
                    if (state.sending) stop()
                    else {
                        val value = text
                        text = ""
                        send(value)
                    }
                }.padding(horizontal = 14.dp, vertical = 12.dp),
            )
        }
    }
    if (deleting) {
        DeleteTalkDialog(thread.title, thread.lines.size, onCancel = { deleting = false }) {
            remove(thread.id)
            deleting = false
        }
    }
    }
}

@Composable
private fun PersonaEditor(state: ChatUi, sending: Boolean, save: (String, String, String) -> Unit) {
    val known = state.personas.any { it.id == state.personaChoice }
    var choice by remember(state.thread?.id, state.personaChoice, state.personas) { mutableStateOf(if (known) state.personaChoice else "default") }
    var body by remember(state.thread?.id, choice, state.defaultPersona, state.personas) {
        mutableStateOf(when (choice) {
            "default" -> state.defaultPersona
            "new" -> ""
            else -> state.personas.find { it.id == choice }?.content.orEmpty()
        })
    }
    var newName by remember(state.thread?.id) { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().heightIn(max = 280.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
        Text("这个对话使用的人设", color = Ink.muted, fontSize = 12.sp)
        Text("默认人设", color = if (choice == "default") Ink.accent else Ink.text, modifier = Modifier.clickable {
            choice = "default"
            body = state.defaultPersona
        }.padding(vertical = 4.dp))
        state.personas.forEach { persona ->
            Text(persona.name, color = if (choice == persona.id) Ink.accent else Ink.text, modifier = Modifier.clickable {
                choice = persona.id
                body = persona.content
            }.padding(vertical = 4.dp))
        }
        if (state.personas.size < 30) {
            Text("为这个对话新建人设", color = if (choice == "new") Ink.accent else Ink.text, modifier = Modifier.clickable {
                choice = "new"
                body = ""
            }.padding(vertical = 4.dp))
        }
        if (choice == "new") MemoryField("人设名称", newName, 80, 1) { newName = it }
        MemoryField(if (choice == "default") "默认人设" else "人设正文", body, 4000, 4) { body = it }
        Text(
            if (choice == "default") "修改默认人设会影响所有没有单独设置的对话。" else if (choice == "new") "保存后加入人设库，这个对话会使用它。" else "这个人设在人设库里，修改会同步到所有使用它的对话。",
            color = Ink.muted,
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text("保存人设", color = if (sending) Ink.muted else Ink.text, modifier = Modifier.clickable(enabled = !sending) { save(choice, body, newName) }.padding(vertical = 8.dp))
    }
}

@Composable
private fun MemoryEditor(
    thread: ThreadUi,
    sending: Boolean,
    save: (String, String, String, String, String, String, String) -> Unit,
    clear: (String) -> Unit,
) {
    val fields = StoryMemory.fields(thread.memory, thread.lines)
    var summary by remember(thread.memory) { mutableStateOf(fields?.summary.orEmpty()) }
    var scene by remember(thread.memory) { mutableStateOf(fields?.scene.orEmpty()) }
    var completed by remember(thread.memory) { mutableStateOf(fields?.completed.orEmpty()) }
    var pending by remember(thread.memory) { mutableStateOf(fields?.pending.orEmpty()) }
    var relationships by remember(thread.memory) { mutableStateOf(fields?.relationships.orEmpty()) }
    var items by remember(thread.memory) { mutableStateOf(fields?.items.orEmpty()) }
    if (fields == null) {
        Text("还没有需要整理的旧剧情。对话变长后，会自动生成记忆。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        return
    }
    Column(Modifier.fillMaxWidth().heightIn(max = 280.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
        Text("已整理前 ${fields.covered} 条消息；后续对话会接着更新这些记录。", color = Ink.muted, fontSize = 12.sp)
        MemoryField("剧情摘要", summary, 2400, 4) { summary = it }
        MemoryField("当前场景", scene, 1000, 2) { scene = it }
        MemoryField("已完成的事", completed, 4800, 3) { completed = it }
        MemoryField("未解决的线索", pending, 4800, 3) { pending = it }
        MemoryField("人物关系", relationships, 4800, 3) { relationships = it }
        MemoryField("物品变化", items, 4800, 3) { items = it }
        Text("每行一项，最多12项，每项最多400字。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("保存记忆", color = if (sending) Ink.muted else Ink.text, modifier = Modifier.clickable(enabled = !sending) {
                save(summary, scene, completed, pending, relationships, items, thread.memory)
            }.padding(vertical = 8.dp))
            Text("清除摘要", color = if (sending) Ink.muted else Ink.accent, modifier = Modifier.clickable(enabled = !sending) { clear(thread.memory) }.padding(vertical = 8.dp))
        }
    }
}

@Composable
private fun MemoryField(label: String, value: String, limit: Int, lines: Int, onChange: (String) -> Unit) {
    Text(label, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
    TextField(
        value = value,
        onValueChange = { onChange(it.take(limit)) },
        modifier = Modifier.fillMaxWidth(),
        minLines = lines,
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

@Composable
private fun StatusBlock(section: PlaySection) {
    if (section.title.isNotBlank()) Text(section.title, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    section.fields.forEach { field ->
        Text("${field.label}  ${field.value}", color = Ink.text, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

private data class LineMedia(
    val audioLabel: String,
    val imageLabel: String,
    val hasAudio: Boolean,
    val hasImage: Boolean,
    val audioReady: Boolean,
    val imageReady: Boolean,
    val checkReady: Boolean,
    val note: String?,
    val check: Boolean,
    val audioPath: String,
    val imagePath: String,
    val partial: String?,
)

@Composable
private fun lineMedia(state: ChatUi, line: Line): LineMedia {
    val audioHash = remember(line.text) { MediaText.hash(line.text, "audio") }
    val imageHash = remember(line.text) { MediaText.hash(line.text, "image") }
    val audio = state.media.find { it.messageId == line.id && it.kind == "audio" && it.sourceHash == audioHash }
    val image = state.media.find { it.messageId == line.id && it.kind == "image" && it.sourceHash == imageHash }
    val audioPending = state.mediaPending.any { it.messageId == line.id && it.kind == "audio" && it.sourceHash == audioHash }
    val imagePending = state.mediaPending.any { it.messageId == line.id && it.kind == "image" && it.sourceHash == imageHash }
    val idle = state.mediaBusy.isBlank() && !state.sending
    val note = when {
        audioPending && imagePending -> "语音和图片正在生成。稍后可检查结果。"
        audioPending -> "角色语音正在生成。稍后可检查结果。"
        imagePending -> "剧情图片正在生成。稍后可检查结果。"
        else -> null
    }
    return LineMedia(
        audioLabel = if (state.mediaBusy == "${line.id}:audio" || audioPending) "生成语音中…" else if (audio != null) "播放语音" else "生成语音",
        imageLabel = if (state.mediaBusy == "${line.id}:image" || imagePending) "生成图片中…" else if (image != null) "查看图片" else "生成图片",
        hasAudio = audio != null,
        hasImage = image != null,
        audioReady = idle && !audioPending,
        imageReady = idle && !imagePending,
        checkReady = idle,
        note = note,
        check = audioPending || imagePending,
        audioPath = if (state.audioMessageId == line.id) state.audioPath else "",
        imagePath = if (state.imageMessageId == line.id) state.imagePath else "",
        partial = audio?.audioTextChars?.takeIf { it in 1 until line.text.length }?.let { "本段朗读前 $it 字" },
    )
}

@Composable
private fun Bubble(line: Line, labels: List<String>, sending: Boolean, canRegenerate: Boolean, fontSize: String, font: String, userBubble: String, assistantBubble: String, opacity: Int, opening: String?, save: (String, String) -> Unit, regenerate: (String) -> Unit, media: LineMedia? = null, onMedia: (String, Boolean) -> Unit = { _, _ -> }, onCheck: () -> Unit = {}) {
    val mine = line.role == "user"
    val clipboard = LocalClipboardManager.current
    var copied by remember(line.id) { mutableStateOf(false) }
    var editing by remember(line.id) { mutableStateOf(false) }
    var draft by remember(line.id, line.text) { mutableStateOf(PlayText.editableBody(line.text)) }
    val visible = PlayText.visible(line.text, line.role, labels)
    val scale = when (fontSize) {
        "small" -> 0.9f
        "large" -> 1.15f
        "xlarge" -> 1.3f
        else -> 1f
    }
    val face = when (font) {
        "serif" -> FontFamily(Typeface.create("serif", Typeface.NORMAL))
        "kai" -> FontFamily(Typeface.create("kaiti", Typeface.NORMAL))
        else -> FontFamily.Default
    }
    val canEdit = line.id != "draft"
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        if (editing) {
            TextField(
                value = draft,
                onValueChange = { draft = it.take(12_000) },
                modifier = Modifier.fillMaxWidth(0.86f),
                minLines = 3,
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
            Text("保留后续聊天原文；受这次修改影响的剧情记忆会在后续对话中重新整理。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("保存修改", color = if (sending) Ink.muted else Ink.text, fontSize = 12.sp, modifier = Modifier.clickable(enabled = !sending) {
                    save(line.id, draft)
                    editing = false
                }.padding(vertical = 6.dp))
                Text("取消", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.clickable {
                    draft = PlayText.editableBody(line.text)
                    editing = false
                }.padding(vertical = 6.dp))
            }
        } else {
            if (!opening.isNullOrBlank()) Text(opening, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 4.dp))
            Text(
                visible,
                color = Ink.text,
                fontSize = 15.sp * scale,
                lineHeight = 22.sp * scale,
                fontFamily = face,
                modifier = Modifier.fillMaxWidth(0.86f).background(bubbleColor(if (mine) userBubble else assistantBubble, if (mine) Ink.bubbleUser else Ink.bubbleAssistant, opacity), RoundedCornerShape(8.dp)).padding(12.dp),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                if (copied) "已复制" else "复制",
                color = Ink.muted,
                fontSize = 12.sp,
                modifier = Modifier.clickable {
                    clipboard.setText(AnnotatedString(visible))
                    copied = true
                }.padding(top = 4.dp),
            )
            if (canEdit && !editing) {
                Text("编辑", color = if (sending) Ink.muted else Ink.accent, fontSize = 12.sp, modifier = Modifier.clickable(enabled = !sending) { editing = true }.padding(top = 4.dp))
            }
            if (canRegenerate && !editing) {
                Text("重新生成", color = if (sending) Ink.muted else Ink.accent, fontSize = 12.sp, modifier = Modifier.clickable(enabled = !sending) { regenerate(line.id) }.padding(top = 4.dp))
            }
            if (media != null && !editing) {
                Text(media.audioLabel, color = if (media.audioReady) Ink.accent else Ink.muted, fontSize = 12.sp, modifier = Modifier.clickable(enabled = media.audioReady) { onMedia("audio", false) }.padding(top = 4.dp))
                if (!media.hasAudio) Text("20 金币", color = Ink.muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                Text(media.imageLabel, color = if (media.imageReady) Ink.accent else Ink.muted, fontSize = 12.sp, modifier = Modifier.clickable(enabled = media.imageReady) { onMedia("image", false) }.padding(top = 4.dp))
                if (!media.hasImage) Text("100 金币", color = Ink.muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                if (media.hasImage) {
                    Text("重新生图", color = if (media.imageReady) Ink.accent else Ink.muted, fontSize = 12.sp, modifier = Modifier.clickable(enabled = media.imageReady) { onMedia("image", true) }.padding(top = 4.dp))
                    Text("100 金币", color = Ink.muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
        media?.note?.let { Text(it, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
        if (media?.check == true) Text(if (media.checkReady) "检查生成结果" else "正在检查…", color = Ink.accent, fontSize = 12.sp, modifier = Modifier.clickable(enabled = media.checkReady) { onCheck() }.padding(top = 2.dp))
        media?.partial?.let { Text(it, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp)) }
        if (!media?.audioPath.isNullOrBlank()) VoiceNote(media.audioPath)
        if (!media?.imagePath.isNullOrBlank()) {
            val bitmap = remember(media.imagePath) { BitmapFactory.decodeFile(media.imagePath)?.asImageBitmap() }
            if (bitmap != null) Image(bitmap, contentDescription = "这一幕", modifier = Modifier.fillMaxWidth(0.86f).height(280.dp).padding(top = 6.dp), contentScale = ContentScale.Fit)
        }
    }
}

@Composable
private fun VoiceNote(path: String) {
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
        modifier = Modifier.fillMaxWidth(0.86f).height(72.dp).padding(top = 6.dp),
    )
}

@Composable
private fun DeleteTalkDialog(title: String, count: Int, onCancel: () -> Unit, onConfirm: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
    Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable(onClick = onCancel))
    Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
        Text("确认删除「$title」？", color = Ink.text, fontSize = 18.sp)
        Text("这 $count 条消息会一并删除，无法通过此操作恢复。需要保留时，请先导出会话。", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp))
        Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("取消", color = Ink.muted, modifier = Modifier.clickable(onClick = onCancel).padding(vertical = 8.dp))
            Text("确认删除", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(onClick = onConfirm).padding(vertical = 8.dp))
        }
    }
    }
}

private fun openingTag(raw: String, index: Int, line: Line): String? {
    if (line.role != "assistant" || raw.isBlank()) return null
    val root = runCatching { org.json.JSONObject(raw) }.getOrNull() ?: return null
    val message = root.optJSONArray("messages")?.optJSONObject(index) ?: return null
    if (message.optString("role") != line.role || message.optString("content").trim() != line.text.trim()) return null
    return when (root.optString("kind")) {
        "background" -> "故事背景"
        "welcome" -> "故事起点"
        else -> "开场白"
    }
}

private fun bubbleColor(hex: String, fallback: Color, opacity: Int): Color {
    val amount = opacity.coerceIn(20, 100) / 100f
    val custom = hex.removePrefix("#").toIntOrNull(16)?.let { Color(0xFF000000.toInt() or it) }
    val base = custom ?: fallback
    if (custom != null) return base.copy(alpha = amount)
    if (opacity == 80) return fallback
    val canvas = Ink.background
    return Color(
        red = base.red * amount + canvas.red * (1f - amount),
        green = base.green * amount + canvas.green * (1f - amount),
        blue = base.blue * amount + canvas.blue * (1f - amount),
    )
}

private fun shareArchive(context: android.content.Context, name: String, json: String) {
    val safe = name.replace(Regex("""[\\/:*?"<>|\s]+"""), "_").take(80).ifBlank { "会话.json" }
    val directory = File(context.cacheDir, "exports").apply { mkdirs() }
    val file = File(directory, safe)
    file.writeText(json)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "application/json"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, safe)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri(safe, uri)
    }
    context.startActivity(Intent.createChooser(send, "导出会话").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
private fun Center(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(text, color = Ink.muted, fontSize = 15.sp) }
}
