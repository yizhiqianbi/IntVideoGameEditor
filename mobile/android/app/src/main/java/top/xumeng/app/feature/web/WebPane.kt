package top.xumeng.app.feature.web

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import top.xumeng.app.MainActivity

@Composable
fun WebPane(activity: MainActivity, url: String) {
    LaunchedEffect(url) { activity.presentWeb(url) }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { activity.acquireWebSlot() },
        onRelease = { activity.releaseWebSlot(it) },
    )
}
