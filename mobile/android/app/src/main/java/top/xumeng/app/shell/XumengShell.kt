package top.xumeng.app.shell

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.content.res.Configuration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.R
import top.xumeng.app.core.network.XumengApi
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import top.xumeng.app.feature.account.InviteScreen
import top.xumeng.app.feature.account.TaskScreen
import top.xumeng.app.feature.account.WalletScreen
import top.xumeng.app.feature.chat.ChatScreen
import top.xumeng.app.feature.studio.AuthorViewModel
import top.xumeng.app.feature.chat.ChatViewModel
import top.xumeng.app.feature.feed.FeedScreen
import top.xumeng.app.feature.feed.FeedViewModel
import top.xumeng.app.feature.forum.ForumScreen
import top.xumeng.app.feature.studio.PresetScreen
import top.xumeng.app.feature.studio.SettingsScreen
import top.xumeng.app.feature.studio.StudioScreen
import top.xumeng.app.feature.studio.VoiceScreen
import top.xumeng.app.feature.generate.GenerateScreen
import top.xumeng.app.feature.novel.NovelScreen
import top.xumeng.app.feature.publish.PublishScreen
import top.xumeng.app.feature.player.PlayerScreen
import top.xumeng.app.feature.player.PlayerViewModel
import top.xumeng.app.feature.profile.ProfileScreen

@Composable
fun XumengApp(shell: ShellViewModel) {
    val owner = LocalLifecycleOwner.current
    val night = (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val theme = AppTheme.mode
    LaunchedEffect(Unit) {
        val stored = withContext(Dispatchers.IO) { runCatching { XumengApi.get(BuildConfig.WEB_ORIGIN).ensureSession() }.getOrNull() }
        if (stored != null) {
            AppTheme.mode = stored.theme
            AppTheme.showFloatingChat = stored.showFloatingChat
            AppTheme.floatingSize = stored.floatingSize
            AppTheme.floatingOpacity = stored.floatingOpacity
        }
    }
    LaunchedEffect(theme, night) { Ink.apply(theme, night) }
    DisposableEffect(owner, shell) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) shell.refreshSession()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val tab = shell.tab
    val feed by viewModel<FeedViewModel>().state.collectAsState()
    val density = LocalDensity.current
    val imeOpen = WindowInsets.ime.getBottom(density) > 0
    var menuOpen by rememberSaveable { mutableStateOf(false) }
    Box(
        Modifier
            .fillMaxSize()
            .background(Ink.background)
            .windowInsetsPadding(
                WindowInsets.statusBars.union(WindowInsets.displayCutout).union(WindowInsets.navigationBars).union(WindowInsets.ime),
            ),
    ) {
        Column(Modifier.fillMaxSize()) {
            if (!imeOpen) {
                Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(44.dp).semantics { contentDescription = if (menuOpen) "关闭导航" else "菜单" }.clickable { menuOpen = !menuOpen },
                        contentAlignment = Alignment.Center,
                    ) { Mark(if (menuOpen) "close" else "more", color = Ink.muted) }
                    Text("叙梦", color = Ink.text, fontSize = 18.sp)
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) { Section(shell, tab) }
        }
        if (menuOpen) {
            Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { menuOpen = false })
            SiteDrawer(tab) { next ->
                menuOpen = false
                shell.select(next)
            }
        }
        val detailOpen = tab == ShellTab.PLAY && (feed.detail != null || feed.openingDetail)
        val hideFloating = menuOpen || imeOpen || tab == ShellTab.CHAT || tab == ShellTab.VIDEO || tab == ShellTab.VOICE || detailOpen
        if (AppTheme.showFloatingChat && !hideFloating) {
            val diameter = when (AppTheme.floatingSize) {
                "small" -> 44.dp
                "large" -> 64.dp
                else -> 54.dp
            }
            Box(
                Modifier.align(Alignment.BottomEnd).padding(22.dp).size(diameter).alpha(AppTheme.floatingOpacity / 100f).clip(CircleShape).background(Ink.accent).semantics { contentDescription = "打开聊天" }.clickable { shell.select(ShellTab.CHAT) },
                contentAlignment = Alignment.Center,
            ) { Mark("chat", size = 24.dp, color = Color.White) }
        }
    }
}

@Composable
private fun Section(shell: ShellViewModel, tab: ShellTab) {
    val feedModel = viewModel<FeedViewModel>()
    val chatModel = viewModel<ChatViewModel>()
    val authorModel = viewModel<AuthorViewModel>()
    when (tab) {
        ShellTab.CHAT -> ChatScreen(shell.chatFocus, shell::consumeChatFocus, shell::noteThread)
        ShellTab.PROFILE -> ProfileScreen(
            onAuthor = { id, name ->
                feedModel.openAuthor(id, name)
                shell.select(ShellTab.PLAY)
            },
            onRole = { id, name -> shell.openCharacter(id, name) },
            onEdit = { id ->
                authorModel.edit(id)
                shell.select(ShellTab.CREATE)
            },
            onSaved = { id ->
                feedModel.openDetail(id)
                shell.select(ShellTab.PLAY)
            },
            onTalk = { id ->
                chatModel.openTalk(id)
                shell.select(ShellTab.CHAT)
            },
            onMenu = { key ->
                val next = when (key) {
                    "create" -> ShellTab.CREATE
                    "settings" -> ShellTab.SETTINGS
                    "presets" -> ShellTab.PRESETS
                    "wallet" -> ShellTab.RECHARGE
                    "invite" -> ShellTab.INVITE
                    else -> null
                }
                if (next != null) shell.select(next)
            },
        )
        ShellTab.VIDEO -> {
            val playerModel = viewModel<PlayerViewModel>()
            PlayerScreen(playerModel, shell.focusedDramaId, shell::consumeDramaFocus) { id, name -> shell.openCharacter(id, name) }
        }
        ShellTab.PLAY -> {
            FeedScreen(
                feedModel,
                onOpen = { card, opening, fresh -> shell.openCharacter(card.id, card.name, opening, fresh) },
                onTopic = shell::openForum,
            )
        }
        ShellTab.NOVELS -> NovelScreen()
        ShellTab.PUBLISH -> PublishScreen(
            onEdit = { id ->
                authorModel.edit(id)
                shell.select(ShellTab.CREATE)
            },
            onCreate = {
                authorModel.edit("new")
                shell.select(ShellTab.CREATE)
            },
            onChat = { id, name -> shell.openCharacter(id, name) },
        )
        ShellTab.GENERATE -> GenerateScreen()
        ShellTab.FORUM -> ForumScreen(shell.forumFocus, shell::consumeForumFocus)
        ShellTab.CREATE -> StudioScreen(
            onChat = { id, name -> shell.openCharacter(id, name) },
            onNovels = { shell.select(ShellTab.NOVELS) },
            onGenerate = { shell.select(ShellTab.GENERATE) },
            onAccount = { shell.select(ShellTab.PROFILE) },
        )
        ShellTab.VOICE -> VoiceScreen()
        ShellTab.PRESETS -> PresetScreen()
        ShellTab.SETTINGS -> SettingsScreen()
        ShellTab.RECHARGE -> WalletScreen()
        ShellTab.TASKS -> TaskScreen()
        ShellTab.INVITE -> InviteScreen()
        else -> SectionHome(tab, shell::select)
    }
}

private data class NavItem(val tab: ShellTab, val label: String, val icon: String)

private val primaryNav = listOf(
    NavItem(ShellTab.VIDEO, "视频", "video"),
    NavItem(ShellTab.PLAY, "游玩", "users"),
    NavItem(ShellTab.CHAT, "陪伴", "chat"),
    NavItem(ShellTab.CREATE, "创作", "edit"),
    NavItem(ShellTab.PROFILE, "我的", "user"),
)

private val toolNav = listOf(
    NavItem(ShellTab.INVITE, "邀请好友", "users"),
    NavItem(ShellTab.NOVELS, "小说创作", "book"),
    NavItem(ShellTab.PUBLISH, "投稿", "check"),
    NavItem(ShellTab.GENERATE, "生成", "sparkles"),
    NavItem(ShellTab.VOICE, "角色语音", "volume"),
    NavItem(ShellTab.TASKS, "任务中心", "trophy"),
    NavItem(ShellTab.RECHARGE, "充值与 VIP", "wallet"),
    NavItem(ShellTab.PRESETS, "模型与预设", "sliders"),
    NavItem(ShellTab.SETTINGS, "设置", "user"),
)

@Composable
private fun SiteDrawer(current: ShellTab, onSelect: (ShellTab) -> Unit) {
    Column(
        Modifier.fillMaxHeight().width(280.dp).background(Color(0xFF16151C)).clickable {}.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
    ) {
        Row(Modifier.padding(start = 20.dp, top = 28.dp, bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.xumeng_mark), contentDescription = null, modifier = Modifier.size(36.dp))
            Spacer(Modifier.width(10.dp))
            Column {
                Text("叙梦", color = Ink.text, fontSize = 18.sp)
                Text("XUMENG", color = Ink.muted, fontSize = 11.sp)
            }
        }
        primaryNav.forEach { DrawerRow(it, current == it.tab, onSelect) }
        Box(Modifier.padding(horizontal = 20.dp, vertical = 10.dp).fillMaxWidth().height(1.dp).background(Ink.line))
        toolNav.forEach { DrawerRow(it, current == it.tab, onSelect) }
    }
}

@Composable
private fun DrawerRow(item: NavItem, selected: Boolean, onSelect: (ShellTab) -> Unit) {
    val color = if (selected) Ink.accent else Ink.text
    Row(
        Modifier.fillMaxWidth().clickable { onSelect(item.tab) }.padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Mark(item.icon, size = 22.dp, color = color)
        Spacer(Modifier.width(14.dp))
        Text(item.label, color = color, fontSize = 16.sp)
    }
}

@Composable
private fun SectionHome(tab: ShellTab, onSelect: (ShellTab) -> Unit) {
    val item = (primaryNav + toolNav).find { it.tab == tab }
    Column(Modifier.fillMaxSize().background(Ink.background).padding(horizontal = 20.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Mark(item?.icon ?: "edit", size = 22.dp, color = Ink.accent)
            Spacer(Modifier.width(10.dp))
            Text(item?.label ?: "叙梦", color = Ink.text, fontSize = 22.sp)
        }
        Spacer(Modifier.height(18.dp))
        if (tab == ShellTab.CREATE) {
            listOf(
                NavItem(ShellTab.PLAY, "角色", "users"),
                NavItem(ShellTab.NOVELS, "小说", "book"),
                NavItem(ShellTab.PUBLISH, "投稿", "check"),
                NavItem(ShellTab.GENERATE, "生成", "sparkles"),
                NavItem(ShellTab.VIDEO, "短剧", "video"),
                NavItem(ShellTab.VOICE, "语音", "volume"),
            ).forEach { entry ->
                Row(
                    Modifier.fillMaxWidth().clickable { onSelect(entry.tab) }.padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Mark(entry.icon, color = Ink.muted)
                    Spacer(Modifier.width(12.dp))
                    Text(entry.label, color = Ink.text, fontSize = 16.sp)
                }
            }
        }
    }
}
