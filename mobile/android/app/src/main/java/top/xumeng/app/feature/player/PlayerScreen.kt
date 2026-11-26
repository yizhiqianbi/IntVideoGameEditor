package top.xumeng.app.feature.player

import android.content.Intent
import android.graphics.Bitmap
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import top.xumeng.app.R
import top.xumeng.app.core.network.ImageStore
import top.xumeng.app.shell.Ink
import kotlin.math.abs

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(model: PlayerViewModel, focusedDramaId: String?, onFocusConsumed: () -> Unit, onCharacter: (String, String) -> Unit) {
    val ui by model.ui.collectAsState()
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, model) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) model.pauseForLifecycle()
            if (event == Lifecycle.Event.ON_RESUME) model.resumeIfWanted()
        }
        owner.lifecycle.addObserver(observer)
        model.resumeIfWanted()
        onDispose {
            owner.lifecycle.removeObserver(observer)
            model.pauseForLifecycle()
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when (val page = ui) {
            PlayerUi.Loading -> Message("正在读取短剧", null, null)
            is PlayerUi.Failed -> Message(page.message, "重新加载") { model.refresh() }
            is PlayerUi.Ready -> Reel(model, page.dramas, focusedDramaId, onFocusConsumed, onCharacter)
        }
    }
}

@Composable
private fun Message(text: String, action: String?, onAction: (() -> Unit)?) {
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text, color = Ink.muted, fontSize = 16.sp)
        if (action != null && onAction != null) {
            Text(
                action,
                color = Color.White,
                fontSize = 15.sp,
                modifier = Modifier.padding(top = 16.dp).clickable(onClick = onAction).padding(8.dp),
            )
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun Reel(
    model: PlayerViewModel,
    dramas: List<DramaTitle>,
    focusedDramaId: String?,
    onFocusConsumed: () -> Unit,
    onCharacter: (String, String) -> Unit,
) {
    val context = LocalContext.current
    val unlocked by model.unlocked.collectAsState()
    val pending by model.pendingEpisode.collectAsState()
    val notice by model.notice.collectAsState()
    val position by model.position.collectAsState()
    val duration by model.duration.collectAsState()
    val marks by model.marks.collectAsState()
    val notes by model.notes.collectAsState()
    val tick = model.tick
    val shown = model.feed(dramas)
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val drama = shown.getOrNull(model.index.coerceIn(0, (shown.size - 1).coerceAtLeast(0)))
    val clip = if (drama == null) null else model.clipAt(shown, model.index)
    var comments by remember(drama?.dramaId) { mutableStateOf(false) }
    var comment by remember(drama?.dramaId) { mutableStateOf("") }
    var drag by remember { mutableFloatStateOf(0f) }
    var frameReady by remember(clip?.mediaUrl, tick) { mutableStateOf(false) }
    var poster by remember(clip?.posterUrl) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(focusedDramaId, dramas) {
        if (!focusedDramaId.isNullOrEmpty()) {
            model.focus(focusedDramaId, dramas)
            onFocusConsumed()
        }
    }
    LaunchedEffect(model.origin, clip?.posterUrl) {
        poster = if (clip == null) null else ImageStore.load(model.origin, clip.posterUrl, 1080)
    }
    DisposableEffect(model.player, clip?.mediaUrl) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() { frameReady = true }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) { frameReady = false }
        }
        model.player.addListener(listener)
        if (model.player.isPlaying || model.player.playbackState == Player.STATE_READY) frameReady = true
        onDispose { model.player.removeListener(listener) }
    }
    if (drama == null || clip == null) {
        Column(Modifier.padding(16.dp)) {
            CategoryRow(model.category) { model.chooseCategory(it, dramas) }
            Text("这一类还没有短剧", color = Ink.muted, modifier = Modifier.padding(top = 24.dp))
        }
        return
    }
    Box(Modifier.fillMaxSize()) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            val root = FrameLayout(context)
            root.setBackgroundColor(android.graphics.Color.BLACK)
            val player = LayoutInflater.from(context).inflate(R.layout.reel_player, root, false) as PlayerView
            root.addView(player, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            val posterView = ImageView(context).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                setBackgroundColor(android.graphics.Color.BLACK)
            }
            root.addView(posterView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            val density = context.resources.displayMetrics.density
            val pad = (20 * density).toInt()
            val title = label(context, 18f, android.graphics.Color.WHITE)
            val meta = label(context, 13f, android.graphics.Color.rgb(190, 185, 199))
            root.addView(title, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
                leftMargin = pad
                rightMargin = pad
                bottomMargin = pad + (22 * density).toInt()
            })
            root.addView(meta, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
                leftMargin = pad
                rightMargin = pad
                bottomMargin = pad
            })
            val touch = ReelTouch(context)
            val catcher = View(context)
            catcher.setOnTouchListener(touch)
            root.addView(catcher, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            root.tag = ReelBinding(player, posterView, title, meta, touch)
            root
        },
        update = { root ->
            val binding = root.tag as ReelBinding
            if (binding.player.player !== model.player) binding.player.player = model.player
            binding.title.text = clip.title
            binding.meta.text = listOfNotNull(clip.episode, clip.category.takeIf { it.isNotBlank() }).joinToString("  ")
            binding.poster.setImageBitmap(poster)
            binding.poster.visibility = if (frameReady) View.GONE else View.VISIBLE
            binding.touch.onDrag = { drag = it }
            binding.touch.onRelease = { total ->
                val threshold = root.height.coerceAtLeast(1) * 0.16f
                val next = when {
                    total < -threshold && model.index < shown.lastIndex -> model.index + 1
                    total > threshold && model.index > 0 -> model.index - 1
                    else -> model.index
                }
                drag = 0f
                root.translationY = 0f
                if (next != model.index) model.moveTo(next, shown)
            }
            binding.touch.onTap = { model.toggle() }
            root.translationY = drag
        },
        onRelease = { root -> (root.tag as? ReelBinding)?.player?.player = null },
    )
    Column(Modifier.padding(start = 16.dp, top = 28.dp, end = 16.dp)) {
        if (searching) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextField(
                    value = query,
                    onValueChange = { query = it.take(80) },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    placeholder = { Text("搜索短剧") },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color(0xFF1C1B22),
                        unfocusedContainerColor = Color(0xFF1C1B22),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        cursorColor = Ink.accent,
                    ),
                )
                Text("取消", color = Ink.muted, modifier = Modifier.clickable { searching = false; query = "" }.padding(8.dp))
            }
            val keyword = query.trim().lowercase()
            val found = if (keyword.isEmpty()) emptyList() else dramas.filter { it.title.lowercase().contains(keyword) }.take(40)
            if (keyword.isNotEmpty() && found.isEmpty()) Text("没有符合的短剧", color = Ink.muted, modifier = Modifier.padding(top = 8.dp))
            found.forEach { item ->
                Text(item.title, color = Color.White, fontSize = 15.sp, modifier = Modifier.clickable {
                    searching = false
                    query = ""
                    model.focus(item.dramaId, dramas)
                }.padding(vertical = 6.dp))
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CategoryRow(model.category) { model.chooseCategory(it, dramas) }
                Text("搜索", color = Color.White, modifier = Modifier.clickable { searching = true }.padding(start = 12.dp, top = 6.dp, bottom = 6.dp))
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            drama.episodes.forEach { episode ->
                val open = episode.number == 1 || episode.id in unlocked
                val selected = clip.episode == episode.label
                Text(
                    if (open) episode.label else "${episode.label} · 50",
                    color = if (selected) Color.White else Ink.muted,
                    fontSize = 13.sp,
                    modifier = Modifier.clickable { model.selectEpisode(drama, episode.id) }.padding(vertical = 6.dp),
                )
            }
        }
        val locked = drama.episodes.find { it.id == pending }
        if (locked != null) {
            Text("解锁${locked.label} · 50 金币", color = Color.White, modifier = Modifier.clickable { model.payPending(drama) }.padding(top = 8.dp))
        }
        if (notice.isNotBlank()) Text(notice, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
        val tags = drama.tags.ifEmpty {
            when {
                drama.category.contains("漫剧") -> listOf("漫剧")
                drama.category.contains("换脸") -> listOf("换脸")
                drama.category.contains("魔改") -> listOf("魔改")
                else -> listOf("短剧")
            }
        }
        if (drama.synopsis.isNotBlank()) Text(drama.synopsis, color = Color.White, fontSize = 13.sp, maxLines = 3, modifier = Modifier.padding(top = 8.dp))
        Text(tags.joinToString("  ") { "#$it" }, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        if (drama.characterId.isNotBlank()) {
            Text("演这个角色", color = Ink.accent, modifier = Modifier.clickable { onCharacter(drama.characterId, drama.title) }.padding(top = 8.dp))
        }
    }
    Column(Modifier.align(Alignment.CenterEnd).padding(end = 16.dp), horizontalAlignment = Alignment.End) {
        val liked = drama.dramaId in marks.likes
        val saved = drama.dramaId in marks.saves
        val count = notes.count { it.dramaId == drama.dramaId }
        Text(if (liked) "已喜欢" else "喜欢", color = if (liked) Ink.accent else Color.White, modifier = Modifier.clickable { model.toggleLike(drama.dramaId) }.padding(vertical = 8.dp))
        Text(if (saved) "已收藏" else "收藏", color = if (saved) Ink.accent else Color.White, modifier = Modifier.clickable { model.toggleSave(drama.dramaId) }.padding(vertical = 8.dp))
        Text(if (count > 0) "评论 $count" else "评论", color = Color.White, modifier = Modifier.clickable { comments = true }.padding(vertical = 8.dp))
        Text("分享", color = Color.White, modifier = Modifier.clickable { shareDrama(context, drama) }.padding(vertical = 8.dp))
    }
    if (comments) {
        Box(Modifier.fillMaxSize().background(Color(0xCC000000)).clickable { comments = false })
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color(0xFF141318), RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("评论", color = Color.White, fontSize = 16.sp, modifier = Modifier.weight(1f))
                Text("关闭", color = Ink.muted, modifier = Modifier.clickable { comments = false }.padding(8.dp))
            }
            val mine = notes.filter { it.dramaId == drama.dramaId }
            if (mine.isEmpty()) Text("还没有评论", color = Ink.muted, modifier = Modifier.padding(vertical = 12.dp))
            mine.forEach { note ->
                Text("我  ${note.body}", color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(vertical = 6.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextField(
                    value = comment,
                    onValueChange = { comment = it.take(120) },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    placeholder = { Text("写一句评论") },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color(0xFF1C1B22),
                        unfocusedContainerColor = Color(0xFF1C1B22),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        cursorColor = Ink.accent,
                    ),
                )
                Text("发送", color = Color.White, modifier = Modifier.clickable {
                    val body = comment
                    comment = ""
                    model.addNote(drama.dramaId, body)
                }.padding(12.dp))
            }
        }
    }
    if (duration > 0L && pending == null) {
        Scrubber(position, duration, Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp)) { model.seekFraction(it) }
    }
    }
}

private fun shareDrama(context: android.content.Context, drama: DramaTitle) {
    val url = "${top.xumeng.app.BuildConfig.WEB_ORIGIN}/#videos/${drama.dramaId}"
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, drama.title)
        putExtra(Intent.EXTRA_TEXT, "${drama.title} $url")
    }
    context.startActivity(Intent.createChooser(send, "分享").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
private fun CategoryRow(selected: String, choose: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        listOf("" to "推荐", "AI成人短剧" to "短剧", "AI成人漫剧" to "漫剧").forEach { (id, label) ->
            Text(label, color = if (selected == id) Color.White else Ink.muted, modifier = Modifier.clickable { choose(id) }.padding(vertical = 6.dp))
        }
    }
}

@Composable
private fun Scrubber(position: Long, duration: Long, modifier: Modifier, seek: (Float) -> Unit) {
    val fraction = (position.toFloat() / duration).coerceIn(0f, 1f)
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Text("${clock(position)} / ${clock(duration)}", color = Color.White, fontSize = 12.sp)
        Box(
            Modifier.fillMaxWidth().height(28.dp).pointerInput(duration) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    fun at(x: Float) = if (size.width <= 0) 0f else (x / size.width).coerceIn(0f, 1f)
                    seek(at(down.position.x))
                    drag(down.id) { change ->
                        seek(at(change.position.x))
                        change.consume()
                    }
                }
            },
        ) {
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.35f)))
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(fraction).height(3.dp).background(Color.White))
        }
    }
}

private fun clock(ms: Long): String {
    val total = (ms / 1000).toInt().coerceAtLeast(0)
    return "%d:%02d".format(total / 60, total % 60)
}

private fun label(context: android.content.Context, size: Float, color: Int): TextView {
    return TextView(context).apply {
        setTextColor(color)
        textSize = size
        setShadowLayer(10f, 0f, 2f, android.graphics.Color.BLACK)
    }
}

private class ReelBinding(
    val player: PlayerView,
    val poster: ImageView,
    val title: TextView,
    val meta: TextView,
    val touch: ReelTouch,
)

private class ReelTouch(context: android.content.Context) : View.OnTouchListener {
    var onDrag: (Float) -> Unit = {}
    var onRelease: (Float) -> Unit = {}
    var onTap: () -> Unit = {}
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downY = 0f
    private var dragging = false

    override fun onTouch(view: View, event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downY = event.y
                dragging = false
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = event.y - downY
                if (!dragging && abs(dy) > slop) dragging = true
                if (dragging) onDrag(dy)
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val dy = event.y - downY
                if (dragging) onRelease(dy) else if (event.actionMasked == MotionEvent.ACTION_UP) {
                    view.performClick()
                    onTap()
                }
                return true
            }
        }
        return true
    }
}
