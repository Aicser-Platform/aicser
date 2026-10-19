"""Enterprise code as Community code reaches it: ``src.enterprise.<rest>`` is the same module
object as ``ee.<rest>`` when Enterprise is enabled (see src/core/ee_import_alias.py), and
doesn't exist otherwise. Community code imports Enterprise only through this name or a
``src.modules.<name>`` shim, never ``ee.`` directly."""
