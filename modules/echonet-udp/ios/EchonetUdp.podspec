Pod::Spec.new do |s|
  s.name           = 'EchonetUdp'
  s.version        = '1.0.0'
  s.summary        = 'UDP transport for ECHONET Lite on the local network'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Cocoro Air Pro'
  s.homepage       = 'https://echonet.jp'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
