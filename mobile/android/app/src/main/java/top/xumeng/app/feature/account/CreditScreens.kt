package top.xumeng.app.feature.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.Membership
import top.xumeng.app.core.network.TaskDesk
import top.xumeng.app.core.network.Wallet
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark

class WalletViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow<Wallet?>(null)
    private val error = MutableStateFlow<String?>(null)
    private val member = MutableStateFlow<Membership?>(null)
    private val memberError = MutableStateFlow<String?>(null)
    private val claiming = MutableStateFlow(false)
    val wallet: StateFlow<Wallet?> = mutable.asStateFlow()
    val failure: StateFlow<String?> = error.asStateFlow()
    val membership: StateFlow<Membership?> = member.asStateFlow()
    val membershipFailure: StateFlow<String?> = memberError.asStateFlow()
    val busy: StateFlow<Boolean> = claiming.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { val id = backend.accountId(); backend.wallet(id) } }
            loaded.fold(
                onSuccess = { mutable.value = it; error.value = null },
                onFailure = { error.value = it.message ?: "余额没有载入" },
            )
        }
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.membership() } }
            loaded.fold(
                onSuccess = { member.value = it; memberError.value = null },
                onFailure = { memberError.value = it.message ?: "会员状态没有载入" },
            )
        }
    }

    fun claim() {
        val current = member.value ?: return
        if (!current.claimable || current.subscriptionId.isBlank() || current.accountId.isBlank() || claiming.value) return
        viewModelScope.launch {
            claiming.value = true
            val done = runCatching { withContext(Dispatchers.IO) { backend.claimMembership(current.accountId, current.subscriptionId) } }
            claiming.value = false
            done.fold(
                onSuccess = { member.value = it; memberError.value = null; refresh() },
                onFailure = { memberError.value = it.message ?: "今日点数没有领取" },
            )
        }
    }
}

class TaskViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow<TaskDesk?>(null)
    private val error = MutableStateFlow<String?>(null)
    val desk: StateFlow<TaskDesk?> = mutable.asStateFlow()
    val failure: StateFlow<String?> = error.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.taskCenter() } }
            loaded.fold(
                onSuccess = { mutable.value = it; error.value = null },
                onFailure = { error.value = it.message ?: "任务没有载入" },
            )
        }
    }

    fun claim(id: String) {
        val account = mutable.value?.accountId ?: return
        viewModelScope.launch {
            val done = runCatching { withContext(Dispatchers.IO) { backend.claimTask(id, account) } }
            done.fold(onSuccess = { refresh() }, onFailure = { error.value = it.message ?: "领取失败" })
        }
    }
}

@Composable
fun WalletScreen() {
    val model = viewModel<WalletViewModel>()
    val wallet by model.wallet.collectAsState()
    val failure by model.failure.collectAsState()
    val membership by model.membership.collectAsState()
    val membershipFailure by model.membershipFailure.collectAsState()
    val busy by model.busy.collectAsState()
    Column(Modifier.fillMaxSize().background(Ink.background)) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Mark("wallet", size = 22.dp, color = Ink.accent)
            Text("Credit", color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(start = 10.dp))
        }
        val book = wallet
        when {
            book == null && failure == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("正在读取余额", color = Ink.muted) }
            book == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(failure ?: "", color = Ink.muted, modifier = Modifier.clickable { model.refresh() }.padding(20.dp)) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                item {
                    Text("${book.available}", color = Ink.text, fontSize = 36.sp)
                    Text("可用 · 预留 ${book.reserved} · 已消费 ${book.spent}", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
                    MembershipBlock(membership, membershipFailure, busy, model::claim)
                    failure?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                }
                items(book.lines) { line ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                        Text(line.model, color = Ink.text, fontSize = 15.sp)
                        Text("${line.status} · 已扣 ${line.charged} · 预留 ${line.reserved}", color = Ink.muted, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun MembershipBlock(member: Membership?, failure: String?, busy: Boolean, claim: () -> Unit) {
    Text("会员", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(bottom = 6.dp))
    when {
        member == null && failure == null -> Text("正在读取会员", color = Ink.muted, fontSize = 13.sp)
        member == null -> Text(failure ?: "", color = Ink.muted, fontSize = 13.sp)
        member.label.isBlank() -> Text("还没有会员", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        else -> {
            Text(member.label, color = Ink.text, fontSize = 15.sp)
            Text(
                "${membershipStatus(member.status)} · 每日 ${member.dailyCredits} · 已领 ${member.claims}/${member.maxClaims}",
                color = Ink.muted,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
            when {
                member.claimable -> Text(if (busy) "领取中" else "领取今日 ${member.reward} Credit", color = Ink.accent, modifier = Modifier.clickable(enabled = !busy, onClick = claim).padding(vertical = 8.dp))
                member.claimed -> Text("今日已领取", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp))
            }
            failure?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp) }
        }
    }
}

private fun membershipStatus(status: String): String = when (status) {
    "active" -> "生效中"
    "expired" -> "已到期"
    "queued" -> "未开始"
    "revoked" -> "已撤销"
    else -> "未开通"
}

@Composable
fun TaskScreen() {
    val model = viewModel<TaskViewModel>()
    val desk by model.desk.collectAsState()
    val failure by model.failure.collectAsState()
    Column(Modifier.fillMaxSize().background(Ink.background)) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Mark("trophy", size = 22.dp, color = Ink.accent)
            Text("任务中心", color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(start = 10.dp))
        }
        val board = desk
        when {
            board == null && failure == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("正在读取任务", color = Ink.muted) }
            board == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(failure ?: "", color = Ink.muted, modifier = Modifier.clickable { model.refresh() }.padding(20.dp)) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                item { Text("任务 Credit ${board.balance}", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp)) }
                items(board.tasks, key = { it.id }) { task ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                        Text(task.title, color = Ink.text, fontSize = 16.sp)
                        Text(task.description, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        Text("${task.progress} / ${task.target} · ${task.reward} Credit", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                        if (task.claimable) Text("领取", color = Ink.accent, modifier = Modifier.clickable { model.claim(task.id) }.padding(top = 6.dp))
                        else if (task.claimed) Text("已领取", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                }
                failure?.let { item { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp) } }
            }
        }
    }
}
