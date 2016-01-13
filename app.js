"use strict";
/*global _, $, z */

var keys_to_single = {
    contacts:       'contact',
    opportunities:  'opportunity',
    addresses:      'address',
    tasks:          'task',
    emails:         'email',
    phones:         'phone'
};

var flatten_arrays = function(results) {
    return _.map(results, function(result){
        _.each(keys_to_single, function(newsy, oldsy) {
            if (result[oldsy])
                result[newsy] = _.first(flatten_arrays(result[oldsy]));
        });
        return result;
    });
};

// ie: map_hash_to_contact_properties({ mobile: "123", "fax": "456" }, "phone") => [{phone: "123", type: "mobile"}, {phone: "456", type: "fax"}]
var map_hash_to_contact_properties = function(data, key_name) {
    return _.map(data, function(value, key){
        var data = {};
        data[key_name] = value;
        data.type = key;
        return data;
    });
};

var make_sub_request = function(bundle, url, lead_id, values) {
    var data = _.clone(values);
    data.lead_id = lead_id;
    var request = {
      'method': 'POST',
      'url': url,
      'params': {
      },
      'headers': {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      'auth': [bundle.auth_fields.api_key, ''],
      'data': JSON.stringify(data)
    };
    var response = z.request(request);
    console.log('Status: ' + response.status_code);
    console.log('Headers: ' + JSON.stringify(response.headers));
    console.log('Content/Body: ' + response.content);
};

var remove_prefix_from_keys = function(data, prefix) {
    return _.map(data, function(item) {
        _.each(item, function(value, key) {
            item[key.replace(prefix, "")] = value;
            delete(item[key]);
        });
        return item;
    });
};

var Zap = {
    new_task_pre_write: function(bundle) {
        var data = JSON.parse(bundle.request.data);
        if ("user_id" in data) {
            data.assigned_to = data.user_id;
        }
        bundle.request.data = JSON.stringify(data);
        return bundle.request;
    },

    new_opportunity_pre_write: function(bundle) {
        var outbound = JSON.parse(bundle.request.data);
        outbound.value = parseInt(parseFloat(outbound.value) * 100, 10);
        bundle.request.data = JSON.stringify(outbound);
        return bundle.request;
    },

    task_pre_poll: function(bundle) {
        var request = bundle.request;

        if ('is_complete' in bundle.trigger_fields) {
            request.params.is_complete = bundle.trigger_fields.is_complete;
        }
        if ('user_id' in bundle.trigger_fields) {
            request.params.user_id = bundle.trigger_fields.user_id;
        }

        return request;
    },

    all_users_pre_poll: function(bundle) {
        var request = bundle.request;
        var org_request = {
          'method': 'GET',
              'url': 'https://app.close.io/api/v1/me',
              'params': {
              },
              'headers': {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              'auth': [bundle.auth_fields.api_key, '']
        };

        var content = JSON.parse(z.request(org_request).content);
        var org_id = content.memberships[0].organization_id;

        request.url = request.url + org_id;


        return request;
    },

    all_users_post_poll: function(bundle) {
        var content = JSON.parse(bundle.response.content).memberships;
        return content;
    },

    opportunity_pre_poll: function(bundle) {
        var request = bundle.request;
        if (bundle.trigger_fields.status_id) {
            request.params.status_id = bundle.trigger_fields.status_id;
        }
        if (bundle.trigger_fields.status_label) {
            request.params.status_label = bundle.trigger_fields.status_label;
        }
        if (bundle.trigger_fields.status_type) {
            request.params.status_type = bundle.trigger_fields.status_type;
        }
        if ('user_id' in bundle.trigger_fields) {
            request.params.user_id = bundle.trigger_fields.user_id;
        }
        if ('value_period' in bundle.trigger_fields) {
            request.params.value_period = bundle.trigger_fields.value_period;
        }
        return request;
    },

    get_lead_info: function(bundle) {
        var lead_request = {
          'method': 'GET',
              'url': 'https://app.close.io/api/v1/lead/' + bundle.lead_id,
              'params': {
              },
              'headers': {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              'auth': [bundle.auth_fields.api_key, '']
        };
        var data  = JSON.parse(z.request(lead_request).content);
        // Expose the first address, phone and email
        if (data.addresses && data.addresses.length) {
            data.address = data.addresses[0];
        }
        if (data.contacts && data.contacts.length) {
            data.contact = data.contacts[0];

            if (data.contact.emails && data.contact.emails.length) {
                data.contact.email = data.contact.emails[0];
            }
            if (data.contact.phones && data.contact.phones.length) {
                data.contact.phone = data.contact.phones[0];
            }
            if (data.contact.urls && data.contact.urls.length) {
                data.contact.url = data.contact.urls[0];
            }
            delete data.contact.emails;
            delete data.contact.phones;
            delete data.contact.urls;
        }

        delete data.addresses;
        delete data.contacts;
        delete data.tasks;
        delete data.opportunities;
        return data;
    },

    opportunity_post_poll: function(bundle) {
        var results = JSON.parse(bundle.response.content).data;
        _.each(results, function(result){
            var cents = result.value;
            result.dollars = "$" + (Math.floor(cents / 100)) + "." + (cents % 100);
            result.cents = cents;
            result.lead = z.dehydrate('get_lead_info', {lead_id: result.lead_id});
        });
        return flatten_arrays(results);
    },
    lead_pre_poll: function(bundle) {
        var request = bundle.request;

        if (bundle.trigger_fields.query) {
            //attempt to remove the user's sort
            var query = bundle.trigger_fields.query;
            var rex = /sort:/.exec(query);
            if (rex) {
                request.params.query = query.substring(0, rex.index + 5) + '-created,' + query.substring(rex.index + 5, query.length);
            } else {
                request.params.query = query + " sort:-created";
            }
        } else {
            request.params.query = 'sort:-created';
        }
        return request;
    },
    lead_v2_pre_poll: function(bundle) {
        return Zap.lead_pre_poll(bundle);
    },
    lead_post_poll: function(bundle) {
        var results = JSON.parse(bundle.response.content).data;
        if (results && results.contacts){
            if (results.contacts[0].emails)
                results.primary_email = results.contacts[0].emails[0].email;
            if (results.contacts[0].phones)
                results.primary_phone = results.contacts[0].phones[0].phone;
        }
        results = flatten_arrays(results);
        return results;
    },
    lead_v2_post_poll: function(bundle) {
        var results = JSON.parse(bundle.response.content).data;
        if (results && results.contacts){
            if (results.contacts[0].emails)
                results.primary_email = results.contacts[0].emails[0].email;
            if (results.contacts[0].phones)
                results.primary_phone = results.contacts[0].phones[0].phone;
        }
        return results;
    },
    new_lead_pre_write: function(bundle) {
        var content = JSON.parse(bundle.request.data);

        var data = {
                'name': content.name,
                'description': content.description,
                'url': content.url,
                'status': content.status,
                'custom': {}
        };

        var convert_fields_into_hash = function(content, valid_fields, prefix) {
            return _.reduce(valid_fields, function(memo, valid_field) {
                var key = prefix + valid_field;
                if (content[key]) {
                    memo[valid_field] = content[key];
                }
                return memo;
            }, {});
        };


        // Convert incoming contact_* fields to populate first object in contacts
        var contact_data = convert_fields_into_hash(content, ["name", "title"], "contact_");

        if (content.contact_phone) {
            if (content.contact_phones) //defend against content.contact_phones being undefined --jason
                content.contact_phones.office = content.contact_phone;
            else
                content.contact_phones = {'office': content.contact_phone};
        }
        if (content.contact_email) {
            if (content.contact_emails) //defend against content.contact_emails being undefined --jason
                content.contact_emails.office = content.contact_email;
            else
                content.contact_emails = {'office': content.contact_email};
        }
        contact_data.phones = map_hash_to_contact_properties(content.contact_phones, "phone");
        contact_data.emails = map_hash_to_contact_properties(content.contact_emails, "email");

        data.contacts = [contact_data];

        // Convert incoming address_* fields to populate first object in addressses
        // defend against there not being any address data and inserting 'addresses': [{}] into the call which causes 400 --jason
        if (content.address_1 || content.address_city || content.address_state || content.address_zipcode || content.address_country) {
            var address_data = convert_fields_into_hash(content, ["label", "address_street_1", "address_street_2", "city", "state", "zipcode", "country"], "address_");
            data.addresses = [address_data];
        }

        _.each(content, function(value, key){
            if(key.length > 7 && key.substr(0, 7) == 'custom.'){
                data.custom[key.substr(7,key.length)] = value;
            }
        });

        bundle.request.data = JSON.stringify(data);
        return bundle.request;
    },
    new_lead_post_write: function(bundle) {
        var fields = bundle.action_fields;
        var content = JSON.parse(bundle.response.content);

        if (!content.id)
            return;

        if (fields.note) {
            make_sub_request(bundle, 'https://app.close.io/api/v1/activity/note/', content.id, {"note": fields.note});
        }
        if (fields.task && fields.task.text) {
            make_sub_request(bundle, 'https://app.close.io/api/v1/task/', content.id, fields.task);
        }
        if (fields.opportunity && fields.opportunity.note) {
            make_sub_request(bundle, 'https://app.close.io/api/v1/opportunity/', content.id, fields.opportunity);
        }
        return;
    },
    new_lead_post_custom_action_fields: function(bundle) {
        var content = JSON.parse(bundle.response.content);
        var fields = [];
        _.each(content.data, function(field, index) {
            fields.push({"type": "unicode", "key": "custom."+field.name, "label": field.name, "help_text": 'This is a custom field.'});
        });
        return fields;
    },
    new_lead_v2_pre_write: function(bundle) {
        var values = bundle.action_fields;
        var data = {
            'name': values.name,
            'description': values.description,
            'url': values.url,
            'status': values.status,
            'custom': {}
        };

        data.addresses = remove_prefix_from_keys(values.addresses, "address_");
        data.contacts = remove_prefix_from_keys(values.contacts, "contact_");

        data.contacts = _.map(data.contacts, function(contact) {
            contact.phones = [];
            contact.emails = [];
            contact.urls = [];
            _.each(contact, function(value, key) {
                var pieces = key.split("_");
                var type = pieces[0];
                var subtype = pieces[1];
                if (type == "phone") {
                    contact.phones.push({phone: value, type: subtype});
                    delete(contact[key]);
                }
                if (type == "email") {
                    contact.emails.push({email: value, type: subtype});
                    delete(contact[key]);
                }
                if (type == "url") {
                    contact.urls.push({url: value, type: 'url'});
                    delete(contact[key]);
                }
            });
            return contact;
        });

        _.each(values, function(value, key){
            if(key.length > 7 && key.substr(0, 7) == 'custom.'){
                data.custom[key.substr(7, key.length)] = value;
            }
        });

        bundle.request.data = JSON.stringify(data);

        return bundle.request;
    },
    new_lead_v2_post_write: function(bundle) {
        var fields = bundle.action_fields;
        var content = JSON.parse(bundle.response.content);

        if (!content.id)
            return;

        fields.tasks = remove_prefix_from_keys(fields.tasks, "task_");
        fields.opportunities = remove_prefix_from_keys(fields.opportunities, "opportunity_");

        _.each(fields.notes, function(note) {
            make_sub_request(bundle, 'https://app.close.io/api/v1/activity/note/', content.id, note);
        });
        _.each(fields.tasks, function(task) {
            make_sub_request(bundle, 'https://app.close.io/api/v1/task/', content.id, task);
        });
        _.each(fields.opportunities, function(opportunity) {
            make_sub_request(bundle, 'https://app.close.io/api/v1/opportunity/', content.id, opportunity);
        });
        return fields;
    },
    new_lead_v2_post_custom_action_fields: function(bundle) {
        return Zap.new_lead_post_custom_action_fields(bundle);
    },
    task_post_poll: function(bundle) {
        var results = JSON.parse(bundle.response.content).data;
        _.each(results, function(result){
            result.lead = z.dehydrate('get_lead_info', {lead_id: result.lead_id});
        });
        return results;
    },
    new_contact_pre_write: function(bundle) {
        var data = JSON.parse(bundle.request.data);

        data.phones = map_hash_to_contact_properties(data.phones, "phone");
        data.emails = map_hash_to_contact_properties(data.emails, "email");
        data.urls = map_hash_to_contact_properties(data.urls, "url");

        bundle.request.data = JSON.stringify(data);
        return bundle.request;
    },

    search_lead_pre_search: function(bundle) {
    /*
    Argument:
      bundle.request.url: <string>
      bundle.request.method: <string> # 'POST'
      bundle.request.auth: <array> # [username, password]
      bundle.request.headers: <object>
      bundle.request.params: <object> # mapped as query string
      bundle.request.data: <string> # str or null

      bundle.url_raw: <string>
      bundle.auth_fields: <object>
      bundle.search_fields: <object> # pruned and replaced users' fields

      bundle.zap: <object> # info about the zap

    The response should be an object of:
      url: <string>
      method: <string> # 'GET', 'POST', 'PATCH', 'PUT', 'DELETE'
      auth: <array> # [username, password]
      headers: <object>
      params: <object> # this will be mapped into the query string
      data: <string> or null # request body: optional if POST, not needed if GET
    */
    var lead_id = bundle.search_fields.lead_id;
    var query = bundle.search_fields.query;
    var request_url = bundle.request.url;
    var params = {
        _limit: 1
    };
    var search_fields = _.pick(bundle.search_fields, 'url', 'name', 'email', 'phone');

    if (lead_id) {
        request_url += lead_id + "/";
    } else if (query) {
        params.query = query;
    } else {
        var searches = _.map(search_fields, function(value, key) {
            return key + ':\\"' + value + '\\"';
        });
        params.query = searches.join(" ");
    }

    return {
      url: request_url,
      method: bundle.request.method,
      auth: bundle.request.auth,
      headers: bundle.request.headers,
      params: params,
      data: bundle.request.data
    }; // or return bundle.request;
  },
  search_lead_post_search: function(bundle) {
      var content = JSON.parse(bundle.response.content);
      return content.data;
  }
};
