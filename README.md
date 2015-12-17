# Kibana

This is a fork of <https://github.com/elastic/kibana/tree/kibana3>   It includes a couple of extra panels which enable reading of log files.

This is something you'd think would be easy in ELK, but seems surprisingly hard!  ELK generally treats each log entry as a discrete entity unrelated to anything else around it.

This is fine for analyzing e.g. webserver access logs, but a lot of logs aren't structured and need to be read as a text file.

Extra Panels:
 - uob_results: This is a simplified version of the builtin "table" panel, which shows search results in a list.  
 - uob_logreader: If a result in uob_results is clicked, this panel then shows the log file and a configurable number of lines above and below the entry.
 
 