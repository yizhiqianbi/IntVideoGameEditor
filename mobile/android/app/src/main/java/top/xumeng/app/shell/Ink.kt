package top.xumeng.app.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color

/** Site colors from tavern.module.css, switched with the account theme. */
internal object Ink {
    var background by mutableStateOf(Color(0xFF130A10))
    var surface by mutableStateOf(Color(0xFF1E1018))
    var text by mutableStateOf(Color(0xFFF8E8EB))
    var muted by mutableStateOf(Color(0xFFC79AA9))
    var line by mutableStateOf(Color(0xFF4B2636))
    var accent by mutableStateOf(Color(0xFFD94C77))
    var bubbleUser by mutableStateOf(Color(0xFF4A1D31))
    var bubbleAssistant by mutableStateOf(Color(0xFF26141F))

    fun apply(mode: String, systemDark: Boolean) {
        val dark = when (mode) {
            "light" -> false
            "system" -> systemDark
            else -> true
        }
        if (dark) {
            background = Color(0xFF130A10)
            surface = Color(0xFF1E1018)
            text = Color(0xFFF8E8EB)
            muted = Color(0xFFC79AA9)
            line = Color(0xFF4B2636)
            accent = Color(0xFFD94C77)
            bubbleUser = Color(0xFF4A1D31)
            bubbleAssistant = Color(0xFF26141F)
        } else {
            background = Color(0xFFF8EEEF)
            surface = Color(0xFFFFFAF9)
            text = Color(0xFF35131F)
            muted = Color(0xFF8A6570)
            line = Color(0xFFEAD5DA)
            accent = Color(0xFFB92F5B)
            bubbleUser = Color(0xFFF0CED8)
            bubbleAssistant = Color(0xFFFFFAF9)
        }
    }
}

internal object AppTheme {
    var mode by mutableStateOf("dark")
    var showFloatingChat by mutableStateOf(true)
    var floatingSize by mutableStateOf("medium")
    var floatingOpacity by mutableStateOf(100)
}
