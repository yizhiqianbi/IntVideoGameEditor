package top.xumeng.app.feature.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.Referral
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink

class InviteViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow<Referral?>(null)
    private val error = MutableStateFlow<String?>(null)
    val referral: StateFlow<Referral?> = mutable.asStateFlow()
    val failure: StateFlow<String?> = error.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.referral() } }
            loaded.fold(
                onSuccess = { mutable.value = it; error.value = null },
                onFailure = { error.value = it.message ?: "邀请码没有载入" },
            )
        }
    }
}

@Composable
fun InviteScreen() {
    val model = viewModel<InviteViewModel>()
    val referral by model.referral.collectAsState()
    val failure by model.failure.collectAsState()
    val clipboard = LocalClipboardManager.current
    Column(Modifier.fillMaxSize().background(Ink.background).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp)) {
        Text("邀请好友", color = Ink.text, fontSize = 22.sp)
        val card = referral
        when {
            card == null && failure == null -> Box(Modifier.fillMaxSize().padding(top = 40.dp), contentAlignment = Alignment.Center) { Text("正在读取邀请码", color = Ink.muted) }
            card == null -> Text(failure ?: "", color = Ink.muted, modifier = Modifier.clickable { model.refresh() }.padding(top = 24.dp))
            card.guest || card.code == null -> Text("登录账号后才能邀请好友。游客没有邀请码。", color = Ink.muted, modifier = Modifier.padding(top = 16.dp))
            else -> {
                Text("邀请码", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 16.dp))
                Text(card.code, color = Ink.text, fontSize = 28.sp, modifier = Modifier.padding(top = 4.dp))
                Text("复制邀请码", color = Ink.accent, modifier = Modifier.clickable { clipboard.setText(AnnotatedString(card.code)) }.padding(vertical = 8.dp))
                card.url?.let { url ->
                    Text(url, color = Ink.muted, fontSize = 13.sp)
                    Text("复制链接", color = Ink.accent, modifier = Modifier.clickable { clipboard.setText(AnnotatedString(url)) }.padding(vertical = 8.dp))
                }
                Text("已邀请 ${card.invited} 人 · 已得 ${card.earned} Credit", color = Ink.text, modifier = Modifier.padding(top = 12.dp))
                Text("每人注册奖励 ${card.reward} Credit", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                if (card.rebate > 0) Text("返利 ${card.rebate}%", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                Text("打开 ${card.opens} · 注册 ${card.registrations} · 开始聊天 ${card.chats}", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                failure?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
            }
        }
    }
}
