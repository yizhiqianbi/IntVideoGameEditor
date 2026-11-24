package top.xumeng.app.shell

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Same 24px stroke icons as src/components/dzmm/icons.tsx. */
object Glyph {
    fun data(name: String): String = when (name) {
        "game" -> "M7 7h10a4 4 0 0 1 3.8 2.8l1.2 7a2.5 2.5 0 0 1-4.2 2.2L15 16H9l-2.8 3a2.5 2.5 0 0 1-4.2-2.2l1.2-7A4 4 0 0 1 7 7Z M6 11v4M4 13h4M16 11h.01M19 14h.01"
        "phone" -> "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"
        "lock" -> "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z M8 11V7a4 4 0 0 1 8 0v4"
        "video" -> "M6 5h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z m9 5 6-4v12l-6-4"
        "volume" -> "m11 5-6 4H2v6h3l6 4V5Z M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"
        "play" -> "m8 4 12 8-12 8V4Z"
        "pause" -> "M7 4h3v16H7zM14 4h3v16h-3z"
        "image" -> "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z M7 8.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 m14 6.5-5-5L5 21"
        "crown" -> "m3 6 4 5 5-7 5 7 4-5-2 12H5L3 6Z M6 21h12"
        "wallet" -> "M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v11H6a3 3 0 0 1-3-3V6 M20 12h-4v5h4M17 14.5h.01"
        "users" -> "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        "chat" -> "M7.9 20A9 9 0 1 0 4 16.1L2 22Z M8 12h.01M12 12h.01M16 12h.01"
        "compass" -> "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0 m14.24-4.24-2.12 6.36-6.36 2.12 2.12-6.36Z"
        "user" -> "M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M20 21a8 8 0 0 0-16 0"
        "search" -> "M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0 m18 10-4.3-4.3"
        "sun" -> "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        "moon" -> "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"
        "heart" -> "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
        "flame" -> "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"
        "shuffle" -> "m18 14 4 4-4 4M18 2l4 4-4 4M2 18h2.5c6 0 6-12 12-12H22M2 6h2.5c2.7 0 4.2 2.4 5.5 5M14 15c.7 1.4 1.5 3 3 3h5"
        "plus" -> "M12 5v14M5 12h14"
        "sliders" -> "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"
        "chevron" -> "m9 18 6-6-6-6"
        "close" -> "m18 6-12 12M6 6l12 12"
        "send" -> "m22 2-7 20-4-9-9-4Z M22 2 11 13"
        "back" -> "m12 19-7-7 7-7M5 12h14"
        "download" -> "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v12m-5-5 5 5 5-5"
        "upload" -> "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 16V3m-5 5 5-5 5 5"
        "edit" -> "m16 3 5 5-12 12-6 1 1-6Z m14 5 5 5"
        "refresh" -> "M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"
        "book" -> "M12 7v14M3 3h4a5 5 0 0 1 5 4 5 5 0 0 1 5-4h4v16h-4a5 5 0 0 0-5 2 5 5 0 0 0-5-2H3Z"
        "trophy" -> "M6 9H4a2 2 0 0 1 0-4h2M18 9h2a2 2 0 0 0 0-4h-2M6 2h12v7a6 6 0 0 1-12 0ZM12 15v5M8 22h8"
        "grid" -> "M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z"
        "check" -> "m5 12 4 4L19 6"
        "sparkles" -> "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z M20 2v4M18 4h4"
        "more" -> "M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0"
        "copy" -> "M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z M16 8V3H3v13h5"
        "stop" -> "M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        else -> "M12 5v14M5 12h14"
    }
}

@Composable
fun Mark(name: String, size: Dp = 18.dp, color: Color = Ink.text, modifier: Modifier = Modifier) {
    val path = remember(name) { PathParser().parsePathString(Glyph.data(name)).toPath() }
    Canvas(modifier.size(size)) {
        val factor = this.size.minDimension / 24f
        scale(factor, factor) {
            drawPath(
                path,
                color,
                style = Stroke(width = 1.8f, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}
