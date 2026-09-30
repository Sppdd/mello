Pod::Spec.new do |s|
  s.name           = 'MelloBlocker'
  s.version        = '0.1.0'
  s.summary        = 'Mello reading gate (Screen Time on iOS)'
  s.author         = 'Mello'
  s.homepage       = 'https://github.com/Sppdd/mello'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
