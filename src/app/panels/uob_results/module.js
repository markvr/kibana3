/** @scratch /panels/5
 *
 * include::panels/table.asciidoc[]
 */

/** @scratch /panels/table/0
 *
 * == table
 * Status: *Stable*
 *
 * Shows a list of search results, that when clicked add a filter so the
 * uob_logreader panel can update and show the full log.  Based on the default
 * "table" panel
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'kbn',
  'moment',
],
        function (angular, app, _, kbn, moment) {
          'use strict';

          var module = angular.module('kibana.panels.uob_results', []);
          app.useModule(module);

          module.controller('uob_results', function ($rootScope, $scope, $modal, $q, $compile, $timeout,
                  fields, querySrv, dashboard, filterSrv) {
            $scope.panelMeta = {
              modals: [
                {
                  description: "Inspect",
                  icon: "icon-info-sign",
                  partial: "app/partials/inspector.html",
                  show: $scope.panel.spyable
                }
              ],
              editorTabs: [
                {
                  title: 'Paging',
                  src: 'app/panels/table/pagination.html'
                },
                {
                  title: 'Queries',
                  src: 'app/partials/querySelect.html'
                }
              ],
              status: "Stable",
              description: "A paginated list of search results"
            };

            // Set and populate defaults
            var _d = {
              /** @scratch /panels/table/5
               * === Parameters
               *
               * size:: The number of hits to show per page
               */
              size: 100, // Per page
              /** @scratch /panels/table/5
               * pages:: The number of pages available
               */
              pages: 5, // Pages available
              /** @scratch /panels/table/5
               * offset:: The current page
               */
              offset: 0,
              /** @scratch /panels/table/5
               * sort:: An array describing the sort order of the table. For example [`@timestamp',`desc']
               */
              sort: ['_score', 'desc'],
              /** @scratch /panels/table/5
               * overflow:: The css overflow property. `min-height' (expand) or `auto' (scroll)
               */
              overflow: 'min-height',
              /** @scratch /panels/table/5
               * fields:: The fields used a columns of the table, in an array.
               */
              fields: [],
              /** @scratch /panels/table/5
               * highlight:: The fields on which to highlight, in an array
               */
              highlight: [],
              /** @scratch /panels/table/5
               * sortable:: Set sortable to false to disable sorting
               */
              sortable: true,
              /** @scratch /panels/table/5
               * header:: Set to false to hide the table column names
               */
              header: true,
              /** @scratch /panels/table/5
               * paging:: Set to false to hide the paging controls of the table
               */
              paging: true,
              /** @scratch /panels/table/5
               * field_list:: Set to false to hide the list of fields. The user will be able to expand it,
               * but it will be hidden by default
               */
              field_list: true,
              /** @scratch /panels/table/5
               * all_fields:: Set to true to show all fields in the mapping, not just the current fields in
               * the table.
               */
              all_fields: false,
              /** @scratch /panels/table/5
               * trimFactor:: The trim factor is the length at which to truncate fields taking the number of
               * columns in the table into consideration. For example, a trimFactor of 100, with 5
               * columns in the table, would trim each column at 20 character. The entirety of the field is
               * still available in the expanded view of the event.
               */
              trimFactor: 300,
              /** @scratch /panels/table/5
               * localTime:: Set to true to adjust the timeField to the browser's local time
               */
              localTime: false,
              /** @scratch /panels/table/5
               * timeField:: If localTime is set to true, this field will be adjusted to the browsers local time
               */
              timeField: '@timestamp',
              /** @scratch /panels/table/5
               * spyable:: Set to false to disable the inspect icon
               */
              spyable: true,
              /** @scratch /panels/table/5
               *
               * ==== Queries
               * queries object:: This object describes the queries to use on this panel.
               * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
               * queries.ids::: In +selected+ mode, which query ids are selected.
               */
              queries: {
                mode: 'all',
                ids: []
              },
              style: {'font-size': '9pt'},
              normTimes: true,
            };
            _.defaults($scope.panel, _d);

            $scope.init = function () {
              $scope.columns = {};
              _.each($scope.panel.fields, function (field) {
                $scope.columns[field] = true;
              });

              $scope.Math = Math;
              $scope.identity = angular.identity;
              $scope.$on('refresh', function () {
                if ($scope.enable_updates) {
                  console.log("refresh called")
                  $scope.get_data();
                } else {
                  console.log("Refresh is false")
                }
              });

              $scope.fields = fields;
              $scope.get_data();
            };

            // Create a percent function for the view
            $scope.percent = kbn.to_percent;

            // This is used to prevent reloading the data in this panel if a result row has been clicked
            $scope.enable_updates = true;

            $scope.closeFacet = function () {
              if ($scope.modalField) {
                delete $scope.modalField;
              }
            };

            $scope.termsModal = function (field, chart) {
              $scope.closeFacet();
              $timeout(function () {
                $scope.modalField = field;
                showModal(
                        '{"height":"200px","chart":"' + chart + '","field":"' + field + '"}', 'terms');
              }, 0);
            };

            $scope.set_sort = function (field) {
              if ($scope.panel.sort[0] === field) {
                $scope.panel.sort[1] = $scope.panel.sort[1] === 'asc' ? 'desc' : 'asc';
              } else {
                $scope.panel.sort[0] = field;
              }
              $scope.get_data();
            };

            $scope.toggle_field = function (field) {
              if (_.indexOf($scope.panel.fields, field) > -1) {
                $scope.panel.fields = _.without($scope.panel.fields, field);
                delete $scope.columns[field];
              } else {
                $scope.panel.fields.push(field);
                $scope.columns[field] = true;
              }
            };

            $scope.toggle_highlight = function (field) {
              if (_.indexOf($scope.panel.highlight, field) > -1) {
                $scope.panel.highlight = _.without($scope.panel.highlight, field);
              } else {
                $scope.panel.highlight.push(field);
              }
            };

            $scope.page = function (page) {
              $scope.panel.offset = page * $scope.panel.size;
              $scope.get_data();
            };

            $scope.build_search = function (field, value, negate) {
              var query;
              // This needs to be abstracted somewhere
              if (_.isArray(value)) {
                query = "(" + _.map(value, function (v) {
                  return angular.toJson(v);
                }).join(" AND ") + ")";
              } else if (_.isUndefined(value)) {
                query = '*';
                negate = !negate;
              } else {
                query = angular.toJson(value);
              }
              $scope.panel.offset = 0;
              filterSrv.set({type: 'field', field: field, query: query, mandate: (negate ? 'mustNot' : 'must')});
            };

            $scope.fieldExists = function (field, mandate) {
              filterSrv.set({type: 'exists', field: field, mandate: mandate});
            };

            $scope.view_file = function (event) {
              console.log("enable_updates off");
              $scope.enable_updates = false;

              // Calling filterSrv.set({}, true) only prevents refreshing the dashboard view, i.e.
              // get_data() still gets called each time, so we end up calling it 6 times!
              //
              // Remove any existing filters we are managing
              _.each(filterSrv.list(), function (filter) {
                if (["file.raw", "host.raw", "offset"].indexOf(filter.field) > -1) {
                  filterSrv.remove(filter.id);
                  console.log("removed filter " + filter.id);
                }
              });
              // Add the new ones
              filterSrv.set({type: 'terms', field: "file.raw", value: event._source.file, mandate: ('must'), active: false});
              console.log("created file.raw filter");
              filterSrv.set({type: 'terms', field: "host.raw", value: event._source.host, mandate: ('must'), active: false});
              console.log("created host.raw filter");
              filterSrv.set({type: 'terms', field: "offset", value: event._source.offset, mandate: ('must'), active: false});
              console.log("created offset filter");

              // This is a hack, but there is some async stuff going on in the background, where
              // if we set_refresh(true) directly then all the previous filter updates still fire
              // So we need a small delay to allow the refresh fns to fire async while refresh is
              // still off.
              setTimeout(function () {
                console.log("refresh on");
                $scope.enable_updates = true;
              }, 100);


            };


            $scope.get_data = function (segment, query_id) {
              console.log("uob_results: get_data called")

              var
                      _segment,
                      request,
                      boolQuery,
                      queries,
                      sort;

              $scope.panel.error = false;

              // Make sure we have everything for the request to complete
              if (dashboard.indices.length === 0) {
                return;
              }

              sort = [$scope.ejs.Sort($scope.panel.sort[0]).order($scope.panel.sort[1])];
              if ($scope.panel.localTime) {
                sort.push($scope.ejs.Sort($scope.panel.timeField).order($scope.panel.sort[1]));
              }


              $scope.panelMeta.loading = true;

              _segment = _.isUndefined(segment) ? 0 : segment;
              $scope.segment = _segment;

              request = $scope.ejs.Request().indices(dashboard.indices[_segment]);

              $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

              queries = querySrv.getQueryObjs($scope.panel.queries.ids);

              boolQuery = $scope.ejs.BoolQuery();
              _.each(queries, function (q) {
                boolQuery = boolQuery.should(querySrv.toEjsObj(q));
              });

              request = request.query(
                      $scope.ejs.FilteredQuery(
                              boolQuery,
                              filterSrv.getBoolFilter(filterSrv.ids())
                              ))
                      .highlight(
                              $scope.ejs.Highlight($scope.panel.highlight)
                              .fragmentSize(2147483647) // Max size of a 32bit unsigned int
                              .preTags('@start-highlight@')
                              .postTags('@end-highlight@')
                              )
                      .size($scope.panel.size * $scope.panel.pages)
                      .sort(sort);

              // Populate scope when we have results
              request.doSearch().then(function (results) {
                console.log("uob_results: got results");
                $scope.panelMeta.loading = false;

                if (_segment === 0) {
                  $scope.panel.offset = 0;
                  $scope.hits = 0;
                  $scope.data = [];
                  $scope.current_fields = [];
                  query_id = $scope.query_id = new Date().getTime();
                }

                // Check for error and abort if found
                if (!(_.isUndefined(results.error))) {
                  $scope.panel.error = $scope.parse_error(results.error);
                  return;
                }

                // Check that we're still on the same query, if not stop
                if ($scope.query_id === query_id) {

                  // This is exceptionally expensive, especially on events with a large number of fields
                  $scope.data = $scope.data.concat(_.map(results.hits.hits, function (hit) {
                    var
                            _h = _.clone(hit),
                            _p = _.omit(hit, '_source', 'sort', '_score');

                    // _source is kind of a lie here, never display it, only select values from it
                    _h.kibana = {
                      _source: _.extend(kbn.flatten_json(hit._source), _p),
                      highlight: kbn.flatten_json(hit.highlight || {})
                    };

                    // Kind of cheating with the _.map here, but this is faster than kbn.get_all_fields
                    $scope.current_fields = $scope.current_fields.concat(_.keys(_h.kibana._source));

                    return _h;
                  }));

                  $scope.current_fields = _.uniq($scope.current_fields);
                  $scope.hits += results.hits.total;

                  // Sort the data
                  $scope.data = _.sortBy($scope.data, function (v) {
                    if (!_.isUndefined(v.sort)) {
                      return v.sort[0];
                    } else {
                      return v._score;
                    }
                  });

                  // Reverse if needed
                  if ($scope.panel.sort[1] === 'desc') {
                    $scope.data.reverse();
                  }

                  // Keep only what we need for the set
                  $scope.data = $scope.data.slice(0, $scope.panel.size * $scope.panel.pages);

                } else {
                  return;
                }

                // If we're not sorting in reverse chrono order, query every index for
                // size*pages results
                // Otherwise, only get size*pages results then stop querying
                if (($scope.data.length < $scope.panel.size * $scope.panel.pages ||
                        !((_.contains(filterSrv.timeField(), $scope.panel.sort[0])) && $scope.panel.sort[1] === 'desc')) &&
                        _segment + 1 < dashboard.indices.length) {
                  $scope.get_data(_segment + 1, $scope.query_id);
                }

              });
            };


            $scope.without_kibana = function (row) {
              var _c = _.clone(row);
              delete _c.kibana;
              return _c;
            };

            $scope.set_refresh = function (state) {
              $scope.refresh = state;
            };

            $scope.close_edit = function () {
              if ($scope.refresh) {
                $scope.get_data();
              }
              $scope.columns = [];
              _.each($scope.panel.fields, function (field) {
                $scope.columns[field] = true;
              });
              $scope.refresh = false;
            };

            $scope.locate = function (obj, path) {
              path = path.split('.');
              var arrayPattern = /(.+)\[(\d+)\]/;
              for (var i = 0; i < path.length; i++) {
                var match = arrayPattern.exec(path[i]);
                if (match) {
                  obj = obj[match[1]][parseInt(match[2], 10)];
                } else {
                  obj = obj[path[i]];
                }
              }
              return obj;
            };


          });

          // This also escapes some xml sequences
          module.filter('tableHighlight', function () {
            return function (text) {
              if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
                return text.toString().
                        replace(/&/g, '&amp;').
                        replace(/</g, '&lt;').
                        replace(/>/g, '&gt;').
                        replace(/\r?\n/g, '<br/>').
                        replace(/@start-highlight@/g, '<code class="highlight">').
                        replace(/@end-highlight@/g, '</code>');
              }
              return '';
            };
          });

          module.filter('tableTruncate', function () {
            return function (text, length, factor) {
              if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
                return text.length > length / factor ? text.substr(0, length / factor) + '...' : text;
              }
              return '';
            };
          });



          module.filter('tableJson', function () {
            var json;
            return function (text, prettyLevel) {
              if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
                json = angular.toJson(text, prettyLevel > 0 ? true : false);
                json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                if (prettyLevel > 1) {
                  /* jshint maxlen: false */
                  json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                    var cls = 'number';
                    if (/^"/.test(match)) {
                      if (/:$/.test(match)) {
                        cls = 'key strong';
                      } else {
                        cls = '';
                      }
                    } else if (/true|false/.test(match)) {
                      cls = 'boolean';
                    } else if (/null/.test(match)) {
                      cls = 'null';
                    }
                    return '<span class="' + cls + '">' + match + '</span>';
                  });
                }
                return json;
              }
              return '';
            };
          });

          // WIP
          module.filter('tableLocalTime', function () {
            return function (text, event) {
              return moment(event.sort[1]).format("YYYY-MM-DDTHH:mm:ss.SSSZ");
            };
          });

        });
