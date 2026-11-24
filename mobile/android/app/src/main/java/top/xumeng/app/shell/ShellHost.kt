package top.xumeng.app.shell

import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.ViewModelProvider
import top.xumeng.app.MainActivity

object ShellHost {
    @JvmStatic
    fun attach(activity: MainActivity, compose: ComposeView) {
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnLifecycleDestroyed(activity))
        val model = ViewModelProvider(activity)[ShellViewModel::class.java]
        activity.consumeLaunchUrl()?.let { model.applyExternalUrl(it) }
        compose.setContent { XumengApp(model) }
    }
}
