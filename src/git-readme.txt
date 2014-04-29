This repository has two remotes:
  origin    github.com/elasticsearch/kibana.git   The main Kibana repo we can pull updates to Kibana
  bb        bitbucket.org/bumjvr/kibana.git       Our private Bitbucket repo to hold customised panels, and other Kibana changes. This can also be pushed to.

The Elasticsearch server - which is what serves the Kibana webpages - has the bitbucket Kibana repo cloned to it.

Once local changes are made and committed on a dev system, push them to the "local" branch on the "bb" repo:
>git push bb local

Then to update the production Kibana, run
>git pull bb local
