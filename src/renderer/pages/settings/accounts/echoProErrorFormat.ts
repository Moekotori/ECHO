import type { Locale } from '../../../i18n/locales';

export const normalizeEchoProErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  const knownCodes = [
    'invalid_credentials',
    'registration_disabled',
    'username_taken',
    'device_limit_reached',
    'session_required',
    'pro_required',
    'invalid_key',
    'key_rejected',
    'key_already_used',
    'release_cooldown',
    'echo_pro_activation_qq_invalid',
    'echo_pro_activation_order_id_invalid',
    'echo_pro_activation_key_invalid',
    'echo_pro_activation_order_activation_limit_exceeded',
    'echo_pro_activation_order_not_found',
    'echo_pro_activation_order_not_paid',
    'echo_pro_activation_order_plan_not_allowed',
    'echo_pro_activation_order_amount_too_low',
    'echo_pro_activation_order_not_eligible',
    'echo_pro_activation_invalid_key',
    'echo_pro_activation_key_rejected',
    'echo_pro_activation_key_already_used',
    'echo_pro_activation_timeout',
    'echo_pro_activation_license_response_invalid',
    'echo_pro_native_license_invalid',
    'echo_pro_activation_package_invalid',
    'echo_pro_activation_package_plugin_mismatch',
    'echo_pro_activation_machine_binding_confirmation_required',
    'echo_pro_activation_replacement_unavailable',
    'echo_pro_activation_replacement_proof_rejected',
    'echo_pro_license_machine-mismatch',
    'echo_pro_activation_http_403',
    'echo_pro_activation_http_409',
    'echo_pro_activation_http_500',
    'echo_pro_device_release_local_license_invalid',
    'echo_pro_device_release_request_invalid',
    'echo_pro_device_release_proof_rejected',
    'echo_pro_device_release_timeout',
    'echo_pro_device_release_response_invalid',
    'echo_pro_device_release_local_cleanup_failed',
    'echo_pro_order_release_order_id_invalid',
    'echo_pro_order_release_activation_not_found',
    'echo_pro_order_release_unbind_cooldown',
    'echo_pro_order_release_timeout',
    'echo_pro_order_release_response_invalid',
    'echo_pro_order_release_local_cleanup_failed',
    'echo_pro_register_unavailable',
    'echo_pro_http_400',
    'echo_pro_http_401',
    'echo_pro_http_403',
    'echo_pro_http_405',
    'echo_pro_http_409',
    'echo_pro_http_500',
  ];
  const matchedCode = knownCodes.find((code) => lowered.includes(code));
  if (matchedCode) {
    return matchedCode;
  }
  if (lowered.includes('405') && lowered.includes('register')) {
    return 'echo_pro_register_unavailable';
  }
  if (lowered.includes('405')) {
    return 'echo_pro_http_405';
  }
  if (lowered.includes('username') && lowered.includes('3-40')) {
    return 'echo_pro_username_use_qq';
  }
  if (lowered.includes('password') && (lowered.includes('8-200') || lowered.includes('10-200'))) {
    return 'echo_pro_password_length';
  }
  if (lowered.includes('password') && lowered.includes('releasing')) {
    return 'echo_pro_release_password_required';
  }
  if (lowered.includes('endpoint') && lowered.includes('not configured')) {
    return 'echo_pro_endpoint_missing';
  }
  return message;
};

export const formatEchoProError = (error: unknown, locale: Locale): string => {
  const code = normalizeEchoProErrorCode(error);
  const zh = locale === 'zh-CN';
  const messages: Record<string, { zh: string; en: string }> = {
    invalid_credentials: {
      zh: '账号或密码不正确。注册/登录账号建议直接填写你的 QQ 号，密码至少 8 位。',
      en: 'The account or password is incorrect. Use your QQ number as the account name, with a password of at least 8 characters.',
    },
    registration_disabled: {
      zh: '服务器暂时关闭公开注册。请使用已授权账号登录，或联系管理员。',
      en: 'Public registration is currently disabled. Sign in with an authorized account or contact the administrator.',
    },
    username_taken: {
      zh: '这个账号已注册。请直接用你的 QQ 号登录，或换另一个 QQ 号注册。',
      en: 'This account is already registered. Sign in with your QQ number, or register with another QQ number.',
    },
    device_limit_reached: {
      zh: '这个账号已绑定 2 台设备。请在已登录设备里点击“解绑所有设备”，然后再登录本机。',
      en: 'This account has already bound 2 devices. Use "Release all devices" on a signed-in device, then sign in here again.',
    },
    session_required: {
      zh: '登录已失效，请重新登录 ECHO Pro。',
      en: 'Your session expired. Please sign in to ECHO Pro again.',
    },
    pro_required: {
      zh: '此功能需要 ECHO Pro。请先登录并兑换 ECHO Pro Key。',
      en: 'This feature requires ECHO Pro. Sign in and redeem an ECHO Pro key first.',
    },
    invalid_key: {
      zh: 'ECHO Pro Key 格式不正确，请检查后再兑换。',
      en: 'The ECHO Pro key format is invalid. Check it and try again.',
    },
    key_rejected: {
      zh: '这个 ECHO Pro Key 无效、已禁用或已过期。',
      en: 'This ECHO Pro key is invalid, disabled, or expired.',
    },
    key_already_used: {
      zh: '这个 ECHO Pro Key 已被使用。',
      en: 'This ECHO Pro key has already been used.',
    },
    release_cooldown: {
      zh: '设备解绑太频繁。为了保护授权，5 小时内只能自助解绑一次。',
      en: 'Device releases are too frequent. Self-service release is limited to once every 5 hours.',
    },
    echo_pro_activation_qq_invalid: {
      zh: 'QQ 号格式不正确，请填写用于核对授权的 QQ 号。',
      en: 'The QQ number format is invalid. Enter the QQ number used for authorization.',
    },
    echo_pro_activation_order_id_invalid: {
      zh: '爱发电订单号格式不正确，请检查后再激活。',
      en: 'The Afdian order ID format is invalid. Check it and try again.',
    },
    echo_pro_activation_key_invalid: {
      zh: 'ECHO Pro Key 格式不正确，请检查后再激活。',
      en: 'The ECHO Pro key format is invalid. Check it and try again.',
    },
    echo_pro_activation_order_activation_limit_exceeded: {
      zh: '这个订单的设备名额已用满。切换到“爱发电订单”，只填写订单号并点击“解绑此订单的设备”，释放名额后即可重新激活。',
      en: 'This order has no free device slots. Switch to Afdian Order, enter only the order ID, and release its devices before activating again.',
    },
    echo_pro_activation_order_not_found: {
      zh: '没有找到这个爱发电订单，请确认订单号和 QQ 号。',
      en: 'This Afdian order was not found. Check the order ID and QQ number.',
    },
    echo_pro_activation_order_not_paid: {
      zh: '这个爱发电订单还不是已支付状态。',
      en: 'This Afdian order is not marked as paid yet.',
    },
    echo_pro_activation_order_plan_not_allowed: {
      zh: '这个爱发电订单不属于可激活 ECHO Pro 的档位。',
      en: 'This Afdian order is not from an ECHO Pro eligible tier.',
    },
    echo_pro_activation_order_amount_too_low: {
      zh: '这个爱发电订单金额必须大于 40 元才能激活 ECHO Pro。',
      en: 'This Afdian order must be greater than RMB 40 to activate ECHO Pro.',
    },
    echo_pro_activation_order_not_eligible: {
      zh: '这个订单暂不满足 ECHO Pro 激活条件。',
      en: 'This order is not eligible for ECHO Pro activation.',
    },
    echo_pro_activation_invalid_key: {
      zh: 'ECHO Pro Key 格式不正确，请检查后再激活。',
      en: 'The ECHO Pro key format is invalid. Check it and try again.',
    },
    echo_pro_activation_key_rejected: {
      zh: '这个 ECHO Pro Key 无效、已禁用或已过期。',
      en: 'This ECHO Pro key is invalid, disabled, or expired.',
    },
    echo_pro_activation_key_already_used: {
      zh: '这个 ECHO Pro Key 的设备名额已用满。如本机仍保存原生授权，可先解绑当前设备；否则请联系管理员协助释放旧设备。',
      en: 'This ECHO Pro key has no free device slots. Release this device if its native license is still available, or contact support to release the old device.',
    },
    echo_pro_activation_timeout: {
      zh: '激活请求超时，请检查网络后重试。',
      en: 'The activation request timed out. Check the network and try again.',
    },
    echo_pro_activation_package_invalid: {
      zh: '服务器返回的旧版授权包无法验证，已安全取消激活。请更新 ECHO 后重试。',
      en: 'The legacy license package could not be verified, so activation was safely cancelled. Update ECHO and try again.',
    },
    echo_pro_activation_package_plugin_mismatch: {
      zh: '服务器返回了不匹配的旧版授权包，已安全取消激活。',
      en: 'The server returned a mismatched legacy license package, so activation was safely cancelled.',
    },
    echo_pro_activation_machine_binding_confirmation_required: {
      zh: '检测到旧授权的 HWID 与本机不匹配，需要确认后才能安全重置并绑定本机。',
      en: 'The old license HWID does not match this device. Confirmation is required before it can be securely reset and rebound.',
    },
    echo_pro_activation_replacement_unavailable: {
      zh: '本机没有足够的旧授权信息，无法自动证明旧设备属于你。请重新输入原订单或 Pro Key；仍失败时联系管理员。',
      en: 'This device does not have enough old license data to prove ownership. Enter the original order or Pro Key again, or contact support.',
    },
    echo_pro_activation_replacement_proof_rejected: {
      zh: '服务器拒绝了旧设备绑定证明，未重置任何 HWID。请确认订单或 Pro Key、QQ 号与原授权一致。',
      en: 'The server rejected the old device proof and did not reset any HWID. Check that the order or Pro Key and QQ match the original license.',
    },
    'echo_pro_license_machine-mismatch': {
      zh: '这份授权记录的是另一台设备。点击“激活此设备”后，ECHO 会先请你确认，再安全释放旧设备并绑定本机。',
      en: 'This license belongs to another device. Choose Activate this device; ECHO will ask for confirmation before safely replacing the old binding.',
    },
    echo_pro_activation_http_403: {
      zh: '服务器拒绝激活。可能是订单/Key 无效、已过期或设备数已满。',
      en: 'The server rejected activation. The order/key may be invalid, expired, or at its device limit.',
    },
    echo_pro_activation_http_409: {
      zh: '设备名额已用满。订单用户可在这里仅凭订单号解绑该订单设备，然后重新激活。',
      en: 'All device slots are in use. Order users can release the order devices here with only the order ID, then activate again.',
    },
    echo_pro_activation_http_500: {
      zh: '激活服务器内部错误，请稍后再试或联系管理员。',
      en: 'The activation server hit an internal error. Try again later or contact the administrator.',
    },
    echo_pro_device_release_local_license_invalid: {
      zh: '没有找到可安全验证的本机 ECHO Pro 授权，无法解绑。',
      en: 'No locally verifiable ECHO Pro license was found for secure device release.',
    },
    echo_pro_device_release_request_invalid: {
      zh: '本机授权证明格式无效，服务器拒绝解绑。',
      en: 'The local license proof was invalid, so the server rejected the release.',
    },
    echo_pro_device_release_proof_rejected: {
      zh: '服务器无法确认该授权属于本机，已拒绝解绑。',
      en: 'The server could not prove this license belongs to the current device.',
    },
    echo_pro_device_release_timeout: {
      zh: '解绑请求超时，授权未确认释放，请检查网络后重试。',
      en: 'The release request timed out. Check the network and try again.',
    },
    echo_pro_device_release_response_invalid: {
      zh: '服务器已响应，但解绑结果无法验证。本机授权已保持禁用，请联系管理员。',
      en: 'The server response could not be verified. The local license remains disabled.',
    },
    echo_pro_device_release_local_cleanup_failed: {
      zh: '服务器已释放本机槽位，但本地授权文件清理失败。授权已禁用，请重启软件后重试清理。',
      en: 'The server released this device, but local license cleanup failed. Restart and retry cleanup.',
    },
    echo_pro_order_release_order_id_invalid: {
      zh: '爱发电订单号格式不正确；订单解绑只需要完整订单号，不需要 QQ。',
      en: 'The Afdian order ID is invalid. Order release requires only the complete order ID.',
    },
    echo_pro_order_release_activation_not_found: {
      zh: '没有找到这个订单的设备绑定记录，请确认订单号完整无误。',
      en: 'No device binding was found for this order. Check the complete order ID.',
    },
    echo_pro_order_release_unbind_cooldown: {
      zh: '这个订单刚完成过解绑。为了保护授权，5 小时内不能再次释放新的绑定。',
      en: 'This order was released recently. New bindings cannot be released again during the 5-hour cooldown.',
    },
    echo_pro_order_release_timeout: {
      zh: '订单解绑请求超时，尚未确认设备名额已释放，请检查网络后重试。',
      en: 'The order release timed out and device slots were not confirmed released. Check the network and retry.',
    },
    echo_pro_order_release_response_invalid: {
      zh: '服务器响应无法证明该订单的有效 HWID 已全部释放，请联系管理员。',
      en: 'The server response did not prove that every active HWID for this order was released.',
    },
    echo_pro_order_release_local_cleanup_failed: {
      zh: '服务器已释放该订单的全部设备，但本机授权文件暂时无法清理。请重启 ECHO，授权不会因此占用服务器名额。',
      en: 'The server released every device for this order, but the local license file could not be removed. Restart ECHO; no server slot remains occupied.',
    },
    echo_pro_activation_license_response_invalid: {
      zh: '服务器返回的授权无法验证。为了保护你的 Pro，ECHO 没有覆盖现有授权；请稍后重试。',
      en: 'The server returned an unverifiable license. ECHO kept the current license unchanged; try again later.',
    },
    echo_pro_native_license_invalid: {
      zh: '新授权的签名或设备信息不正确。ECHO 已保留原授权，不会导致 Pro 丢失。',
      en: 'The new license signature or device information is invalid. ECHO kept the previous license so Pro access is not lost.',
    },
    echo_pro_register_unavailable: {
      zh: '注册接口暂不可用。请确认服务器已部署最新版，并建议使用 QQ 号作为账号注册。',
      en: 'Registration is temporarily unavailable. Make sure the latest server is deployed, and use your QQ number as the account name.',
    },
    echo_pro_http_400: {
      zh: '提交的信息格式不正确。账号建议填写 QQ 号，密码至少 8 位。',
      en: 'The submitted information is invalid. Use your QQ number as the account name and a password of at least 8 characters.',
    },
    echo_pro_http_401: {
      zh: '认证失败。请检查账号、密码，或重新登录。',
      en: 'Authentication failed. Check your account and password, or sign in again.',
    },
    echo_pro_http_403: {
      zh: '服务器拒绝了请求。可能是账号未授权、设备数已满或 Key 不可用。',
      en: 'The server rejected the request. The account may not be authorized, the device limit may be reached, or the key may be unavailable.',
    },
    echo_pro_http_405: {
      zh: '服务器接口方法不匹配，通常是线上 nginx/服务端还没更新。请重新部署最新版 ECHO Pro 云端服务。',
      en: 'The server route does not accept this method, usually because nginx or the cloud service is outdated. Redeploy the latest ECHO Pro cloud service.',
    },
    echo_pro_http_409: {
      zh: '账号冲突。这个 QQ 号可能已经注册，请直接登录。',
      en: 'Account conflict. This QQ number may already be registered, so try signing in.',
    },
    echo_pro_http_500: {
      zh: '服务器内部错误，请稍后再试或联系管理员。',
      en: 'The server hit an internal error. Try again later or contact the administrator.',
    },
    echo_pro_username_use_qq: {
      zh: '账号建议填写 QQ 号，只能包含字母、数字、点、下划线、@ 或短横线，长度 3-40。',
      en: 'Use your QQ number as the account name. It must be 3-40 characters and may contain letters, numbers, dot, underscore, @, or dash.',
    },
    echo_pro_password_length: {
      zh: '密码长度需要 8-200 位。',
      en: 'Password length must be 8-200 characters.',
    },
    echo_pro_release_password_required: {
      zh: '解绑所有设备前，请输入当前 ECHO Pro 账号密码。',
      en: 'Enter your current ECHO Pro password before releasing all devices.',
    },
    echo_pro_endpoint_missing: {
      zh: 'ECHO Pro 服务器地址未配置或不安全。',
      en: 'The ECHO Pro server endpoint is not configured or is not secure.',
    },
  };
  const known = messages[code];
  if (known) {
    return zh ? known.zh : known.en;
  }
  return code.replace(/^Error invoking remote method '[^']+': Error:\s*/u, '');
};

