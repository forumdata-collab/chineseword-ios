#!/usr/bin/env python3
"""Generate the Xcode project (chineseword-ios.xcodeproj) for the iOS port.

Writes project.pbxproj + the shared .xcscheme. UUIDs are derived
deterministically from object names (md5, first 24 hex chars) so re-running
produces the same project.

Layout:
  chineseword-ios.xcodeproj/
  chineseword-ios/            (Swift sources, Info.plist, LaunchScreen, Assets.xcassets, splash_bg.jpg)
  site/                       (folder reference — the bundled offline site)

Run: python3 tools/gen_xcodeproj.py
"""
import hashlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROJ = ROOT / "chineseword-ios.xcodeproj"
SRC = "chineseword-ios"

SWIFT_FILES = [
    "AppDelegate.swift",
    "AssetServer.swift",
    "AppWebConfig.swift",
    "MainViewController.swift",
    "SplashViewController.swift",
    "Theme.swift",
    "TTSBridge.swift",
    "UpdateChecker.swift",
]
# (name, path, filetype) for frameworks linked from the SDK.
FRAMEWORKS = [
    ("WebKit.framework", "System/Library/Frameworks/WebKit.framework"),
    ("AVFoundation.framework", "System/Library/Frameworks/AVFoundation.framework"),
    ("Network.framework", "System/Library/Frameworks/Network.framework"),
]


def uid(name: str) -> str:
    return hashlib.md5(name.encode()).hexdigest()[:24].upper()


# ---- UUIDs ---------------------------------------------------------------
U = {}
def u(key):
    if key not in U:
        U[key] = uid("chineseword-ios:" + key)
    return U[key]


PROJECT = u("project")
TARGET = u("target")
MAIN_GROUP = u("group:main")
SRC_GROUP = u("group:src")
PRODUCTS_GROUP = u("group:products")
SOURCES_PHASE = u("phase:sources")
FRAMEWORKS_PHASE = u("phase:frameworks")
RESOURCES_PHASE = u("phase:resources")
PROJ_CFG_LIST = u("cfglist:project")
TARGET_CFG_LIST = u("cfglist:target")
PROJ_CFG_DEBUG = u("cfg:project:Debug")
PROJ_CFG_RELEASE = u("cfg:project:Release")
TARGET_CFG_DEBUG = u("cfg:target:Debug")
TARGET_CFG_RELEASE = u("cfg:target:Release")
PRODUCT_REF = u("fileref:product")

build_files = {}   # key -> build file uuid
file_refs = {}     # key -> file ref uuid


def build_file(key):
    if key not in build_files:
        build_files[key] = u("buildfile:" + key)
    return build_files[key]


def file_ref(key):
    if key not in file_refs:
        file_refs[key] = u("fileref:" + key)
    return file_refs[key]


# ---- Build the objects dict ----------------------------------------------
objects = {}


def add(uuid, isa, comment, body):
    objects[uuid] = (isa, comment, body)


# Swift source files
for f in SWIFT_FILES:
    key = "src:" + f
    add(build_file(key), "PBXBuildFile", f" {f} in Sources",
        "fileRef = %s /* %s */;" % (file_ref(key), f))
    add(file_ref(key), "PBXFileReference", f,
        "explicitFileType = sourcecode.swift; path = %s; sourceTree = \"<group>\";" % f)

# Frameworks
for name, path in FRAMEWORKS:
    key = "fw:" + name
    add(build_file(key), "PBXBuildFile", f" {name} in Frameworks",
        "fileRef = %s /* %s */;" % (file_ref(key), name))
    add(file_ref(key), "PBXFileReference", name,
        'lastKnownFileType = wrapper.framework; name = %s; path = %s; sourceTree = SDKROOT;' % (name, path))

# Resources: Assets.xcassets, LaunchScreen.storyboard, splash_bg.jpg, site/ folder
RESOURCES = [
    ("Assets.xcassets", "folder.assetcatalog", "Assets.xcassets"),
    ("LaunchScreen.storyboard", "file.storyboard", "LaunchScreen.storyboard"),
    ("splash_bg.jpg", "image.jpeg", "splash_bg.jpg"),
]
for fname, ftype, path in RESOURCES:
    key = "res:" + fname
    add(build_file(key), "PBXBuildFile", f" {fname} in Resources",
        "fileRef = %s /* %s */;" % (file_ref(key), fname))
    add(file_ref(key), "PBXFileReference", fname,
        "lastKnownFileType = %s; path = %s; sourceTree = \"<group>\";" % (ftype, path))

# site/ folder reference (whole bundled site, contents copied at build time)
SITE_KEY = "res:site"
add(build_file(SITE_KEY), "PBXBuildFile", " site in Resources",
    "fileRef = %s /* site */;" % file_ref(SITE_KEY))
add(file_ref(SITE_KEY), "PBXFileReference", "site",
    "lastKnownFileType = folder; path = site; sourceTree = SOURCE_ROOT;")

# Info.plist (referenced by build setting, not a build phase)
add(file_ref("Info.plist"), "PBXFileReference", "Info.plist",
    'lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";')

# Product
add(PRODUCT_REF, "PBXFileReference", "chineseword-ios.app",
    "explicitFileType = wrapper.application; includeInIndex = 0; path = chineseword-ios.app; sourceTree = BUILT_PRODUCTS_DIR;")

# Build phases
src_files = "\n".join(
    "\t\t\t\t%s /* %s in Sources */," % (build_file("src:" + f), f) for f in SWIFT_FILES)
add(SOURCES_PHASE, "PBXSourcesBuildPhase", "Sources",
    "buildActionMask = 2147483647;\n\t\t\tfiles = (\n%s\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;" % src_files)
fw_files = "\n".join(
    "\t\t\t\t%s /* %s in Frameworks */," % (build_file("fw:" + n), n) for n, _ in FRAMEWORKS)
add(FRAMEWORKS_PHASE, "PBXFrameworksBuildPhase", "Frameworks",
    "buildActionMask = 2147483647;\n\t\t\tfiles = (\n%s\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;" % fw_files)
res_files = "\n".join(
    "\t\t\t\t%s /* %s in Resources */," % (build_file("res:" + fname), fname)
    for fname, _, _ in RESOURCES)
res_files += "\n\t\t\t\t%s /* site in Resources */," % build_file(SITE_KEY)
add(RESOURCES_PHASE, "PBXResourcesBuildPhase", "Resources",
    "buildActionMask = 2147483647;\n\t\t\tfiles = (\n%s\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;" % res_files)

# Groups
src_children = "\n".join(
    "\t\t\t\t%s /* %s */," % (file_ref("src:" + f), f) for f in SWIFT_FILES)
src_children += "\n\t\t\t\t%s /* Assets.xcassets */," % file_ref("res:Assets.xcassets")
src_children += "\n\t\t\t\t%s /* LaunchScreen.storyboard */," % file_ref("res:LaunchScreen.storyboard")
src_children += "\n\t\t\t\t%s /* splash_bg.jpg */," % file_ref("res:splash_bg.jpg")
src_children += "\n\t\t\t\t%s /* Info.plist */," % file_ref("Info.plist")
add(SRC_GROUP, "PBXGroup", "chineseword-ios",
    "children = (\n%s\n\t\t\t);\n\t\t\tpath = chineseword-ios;\n\t\t\tsourceTree = \"<group>\";" % src_children)
add(MAIN_GROUP, "PBXGroup", None,
    "children = (\n\t\t\t\t%s /* chineseword-ios */,\n\t\t\t\t%s /* site */,\n\t\t\t\t%s /* Products */,\n\t\t\t);\n\t\t\tsourceTree = \"<group>\";" % (SRC_GROUP, file_ref(SITE_KEY), PRODUCTS_GROUP))
add(PRODUCTS_GROUP, "PBXGroup", "Products",
    "children = (\n\t\t\t\t%s /* chineseword-ios.app */,\n\t\t\t);\n\t\t\tname = Products;\n\t\t\tsourceTree = \"<group>\";" % PRODUCT_REF)

# Target
add(TARGET, "PBXNativeTarget", "chineseword-ios",
    "buildConfigurationList = %s /* Build configuration list for PBXNativeTarget \"chineseword-ios\" */;\n"
    "\t\t\tbuildPhases = (\n\t\t\t\t%s /* Sources */,\n\t\t\t\t%s /* Frameworks */,\n\t\t\t\t%s /* Resources */,\n\t\t\t);\n"
    "\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = chineseword-ios;\n"
    "\t\t\tproductName = chineseword-ios;\n\t\t\tproductReference = %s /* chineseword-ios.app */;\n"
    "\t\t\tproductType = \"com.apple.product-type.application\";"
    % (TARGET_CFG_LIST, SOURCES_PHASE, FRAMEWORKS_PHASE, RESOURCES_PHASE, PRODUCT_REF))

# Project
add(PROJECT, "PBXProject", None,
    "attributes = {\n\t\t\t\tLastSwiftUpdateCheck = 1500;\n\t\t\t\tLastUpgradeCheck = 1500;\n"
    "\t\t\t\tTargetAttributes = {\n\t\t\t\t\t%s = {\n\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;\n\t\t\t\t\t};\n\t\t\t\t};\n\t\t\t};\n"
    "\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXProject \"chineseword-ios\" */;\n"
    "\t\t\tcompatibilityVersion = \"Xcode 14.0\";\n\t\t\tdevelopmentRegion = en;\n\t\t\thasScannedForEncodings = 0;\n"
    "\t\t\tknownRegions = (\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t);\n\t\t\tmainGroup = %s;\n"
    "\t\t\tproductRefGroup = %s /* Products */;\n\t\t\tprojectDirPath = \"\";\n\t\t\tprojectRoot = \"\";\n"
    "\t\t\ttargets = (\n\t\t\t\t%s /* chineseword-ios */,\n\t\t\t);"
    % (TARGET, PROJ_CFG_LIST, MAIN_GROUP, PRODUCTS_GROUP, TARGET))

# Build configurations
PROJ_COMMON = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS": "YES",
    "CLANG_ANALYZER_NONNULL": "YES",
    "CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION": "YES_AGGRESSIVE",
    "CLANG_CXX_LANGUAGE_STANDARD": '"gnu++20"',
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "CLANG_ENABLE_OBJC_WEAK": "YES",
    "CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING": "YES",
    "CLANG_WARN_BOOL_CONVERSION": "YES",
    "CLANG_WARN_COMMA": "YES",
    "CLANG_WARN_CONSTANT_CONVERSION": "YES",
    "CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS": "YES",
    "CLANG_WARN_DIRECT_OBJC_ISA_USAGE": "YES_ERROR",
    "CLANG_WARN_DOCUMENTATION_COMMENTS": "YES",
    "CLANG_WARN_EMPTY_BODY": "YES",
    "CLANG_WARN_ENUM_CONVERSION": "YES",
    "CLANG_WARN_INFINITE_RECURSION": "YES",
    "CLANG_WARN_INT_CONVERSION": "YES",
    "CLANG_WARN_NON_LITERAL_NULL_CONVERSION": "YES",
    "CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF": "YES",
    "CLANG_WARN_OBJC_LITERAL_CONVERSION": "YES",
    "CLANG_WARN_OBJC_ROOT_CLASS": "YES_ERROR",
    "CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER": "YES",
    "CLANG_WARN_RANGE_LOOP_ANALYSIS": "YES",
    "CLANG_WARN_STRICT_PROTOTYPES": "YES",
    "CLANG_WARN_SUSPICIOUS_MOVE": "YES",
    "CLANG_WARN_UNGUARDED_AVAILABILITY": "YES_AGGRESSIVE",
    "CLANG_WARN_UNREACHABLE_CODE": "YES",
    "CLANG_WARN__DUPLICATE_METHOD_MATCH": "YES",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "GCC_DYNAMIC_NO_PIC": "NO",
    "GCC_NO_COMMON_BLOCKS": "YES",
    "GCC_WARN_64_TO_32_BIT_CONVERSION": "YES",
    "GCC_WARN_ABOUT_RETURN_TYPE": "YES_ERROR",
    "GCC_WARN_UNDECLARED_SELECTOR": "YES",
    "GCC_WARN_UNINITIALIZED_AUTOS": "YES_AGGRESSIVE",
    "GCC_WARN_UNUSED_FUNCTION": "YES",
    "GCC_WARN_UNUSED_VARIABLE": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "15.0",
    "LOCALIZATION_PREFS": '""',
    "MTL_FAST_MATH": "YES",
    "SDKROOT": "iphoneos",
}
TARGET_COMMON = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "35",
    "INFOPLIST_FILE": "chineseword-ios/Info.plist",
    "IPHONEOS_DEPLOYMENT_TARGET": "15.0",
    "LD_RUNPATH_SEARCH_PATHS": '(\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"@executable_path/Frameworks",\n\t\t\t\t)',
    "MARKETING_VERSION": "2.31",
    "PRODUCT_BUNDLE_IDENTIFIER": "me.we1co.chineseword",
    "PRODUCT_NAME": '"$(TARGET_NAME)"',
    "SWIFT_VERSION": "5.0",
    "TARGETED_DEVICE_FAMILY": '"1,2"',
}


def settings_block(d):
    lines = []
    for k in sorted(d):
        lines.append("\t\t\t\t%s = %s;" % (k, d[k]))
    return "\n".join(lines)


def xcconfig(uuid, name, settings):
    add(uuid, "XCBuildConfiguration", name,
        "buildSettings = {\n%s\n\t\t\t};\n\t\t\tname = %s;" % (settings_block(settings), name))


xcconfig(PROJ_CFG_DEBUG, "Debug", dict(PROJ_COMMON, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_TESTABILITY": "YES",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "GCC_PREPROCESSOR_DEFINITIONS": '(\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"DEBUG=1",\n\t\t\t\t)',
    "MTL_ENABLE_DEBUG_INFO": "INCLUDE_SOURCE",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
    "SWIFT_OPTIMIZATION_LEVEL": '"-Onone"',
}))
xcconfig(PROJ_CFG_RELEASE, "Release", dict(PROJ_COMMON, **{
    "DEBUG_INFORMATION_FORMAT": '"dwarf-with-dsym"',
    "ENABLE_NS_ASSERTIONS": "NO",
    "GCC_OPTIMIZATION_LEVEL": "s",
    "MTL_ENABLE_DEBUG_INFO": "NO",
    "SWIFT_COMPILATION_MODE": "wholemodule",
    "SWIFT_OPTIMIZATION_LEVEL": '"-O"',
}))
xcconfig(TARGET_CFG_DEBUG, "Debug", dict(TARGET_COMMON, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_TESTABILITY": "YES",
    "GCC_PREPROCESSOR_DEFINITIONS": '(\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"DEBUG=1",\n\t\t\t\t)',
    "MTL_ENABLE_DEBUG_INFO": "INCLUDE_SOURCE",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
    "SWIFT_OPTIMIZATION_LEVEL": '"-Onone"',
}))
xcconfig(TARGET_CFG_RELEASE, "Release", dict(TARGET_COMMON, **{
    "COPY_PHASE_STRIP": "NO",
    "DEBUG_INFORMATION_FORMAT": '"dwarf-with-dsym"',
    "ENABLE_NS_ASSERTIONS": "NO",
    "MTL_ENABLE_DEBUG_INFO": "NO",
    "SWIFT_COMPILATION_MODE": "wholemodule",
    "SWIFT_OPTIMIZATION_LEVEL": '"-O"',
}))

# Configuration lists
add(PROJ_CFG_LIST, "XCConfigurationList", 'Build configuration list for PBXProject "chineseword-ios"',
    "buildConfigurations = (\n\t\t\t\t%s /* Debug */,\n\t\t\t\t%s /* Release */,\n\t\t\t);\n"
    "\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;"
    % (PROJ_CFG_DEBUG, PROJ_CFG_RELEASE))
add(TARGET_CFG_LIST, "XCConfigurationList", 'Build configuration list for PBXNativeTarget "chineseword-ios"',
    "buildConfigurations = (\n\t\t\t\t%s /* Debug */,\n\t\t\t\t%s /* Release */,\n\t\t\t);\n"
    "\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;"
    % (TARGET_CFG_DEBUG, TARGET_CFG_RELEASE))

# ---- Emit ---------------------------------------------------------------
lines = ["// !$*UTF8*$!", "{", "\tarchiveVersion = 1;", "\tclasses = {", "\t};",
         "\tobjectVersion = 56;", "\tobjects = {"]
for uuid in sorted(objects):
    isa, comment, body = objects[uuid]
    c = " /* %s */" % comment if comment else ""
    lines.append("\t\t%s%s = {" % (uuid, c))
    lines.append("\t\t\tisa = %s;" % isa)
    for line in body.split("\n"):
        lines.append("\t\t\t" + line)
    lines.append("\t\t};")
lines += ["\t};", "\trootObject = %s /* Project object */;" % PROJECT, "}"]
PROJ.mkdir(parents=True, exist_ok=True)
(PROJ / "project.pbxproj").write_text("\n".join(lines) + "\n", encoding="utf-8")

# ---- Scheme ---------------------------------------------------------------
scheme_dir = PROJ / "xcshareddata" / "xcschemes"
scheme_dir.mkdir(parents=True, exist_ok=True)
ref = ('<BuildableReference\n               BuildableIdentifier = "primary"\n'
       '               BlueprintIdentifier = "%s"\n'
       '               BuildableName = "chineseword-ios.app"\n'
       '               BlueprintName = "chineseword-ios"\n'
       '               ReferencedContainer = "container:chineseword-ios.xcodeproj">\n'
       '            </BuildableReference>' % TARGET)
scheme = """<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1500"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES"
      buildArchitectures = "Automatic">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            __REF__
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
      <Testables>
      </Testables>
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         __REF__
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         __REF__
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
""".replace("__REF__", ref)
(scheme_dir / "chineseword-ios.xcscheme").write_text(scheme, encoding="utf-8")

print("wrote %s (%d objects)" % (PROJ / "project.pbxproj", len(objects)))
print("wrote %s" % (scheme_dir / "chineseword-ios.xcscheme"))
print("target UUID:", TARGET)
