keys_to_single = {
    contacts:       'contact',
    opportunities:  'opportunity',
    addresses:      'address',
    tasks:          'task',
    emails:         'email',
    phones:         'phone'
};

flatten_arrays = function(results) {
    return _.map(results, function(result){
        _.each(keys_to_single, function(newsy, oldsy) {
            if (result[oldsy])
                result[newsy] = _.first(flatten_arrays(result[oldsy]));
        });
        return result;
    });
};

var Zap = {
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
        request = bundle.request;
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
        data  = JSON.parse(z.request(lead_request).content);
        delete data.tasks;
        delete data.opportunities;
        delete data.contacts;
        return data;
    },

    opportunity_post_poll: function(bundle) {
        results = JSON.parse(bundle.response.content).data;
        _.each(results, function(result){
            cents = result.value;
            result.dollars = "$" + (Math.floor(cents / 100)) + "." + (cents % 100);
            result.cents = cents;
            result.lead = z.dehydrate('get_lead_info', {lead_id: result.lead_id});
        });
        return flatten_arrays(results);
    },
    lead_pre_poll: function(bundle) {
        request = bundle.request;
        
        if (bundle.trigger_fields.query) {
            //attempt to remove the user's sort
            query = bundle.trigger_fields.query;
            var rex = /sort:/.exec(query);
            if (rex) {
                request.params.query = query.substring(0, rex.index + 5) + '-created,' + query.substring(rex.index + 5, query.length);
            } else {
                request.params.query = query + " sort:-created";
            }
        } else {
            request.params.query = 'sort:-created';
        }
        
        /*if (bundle.trigger_fields.status_id) {
            request.params.status_id = bundle.trigger_fields.status_id;
        }
        if (bundle.trigger_fields.status_label) {
            request.params.status_label = bundle.trigger_fields.status_label;
        }*/
        return request;
    },
    lead_post_poll: function(bundle) {
        results = JSON.parse(bundle.response.content).data;
        if (results && results.contacts){
            if (results.contacts[0].emails)
                results.primary_email = results.contacts[0].emails[0].email;
            if (results.contacts[0].phones)
                results.primary_phone = results.contacts[0].phones[0].phone;
        }
        results = flatten_arrays(results);
        return results;
    },
    new_lead_pre_write: function(bundle) {
        content = JSON.parse(bundle.request.data);
        
        data = {
                'name': content.name,
                'description': content.description,
                'url': content.url,
                'status': content.status,
                'custom': {}
        };
        
        // Convert incoming contact_* fields to populate first object in contacts
        if (content.contact_name || content.contact_title || content.contact_email || content.contact_phone)
            data.contacts = [{}];
        if (content.contact_name)
            data.contacts[0].name = content.contact_name;
        if (content.contact_title)
            data.contacts[0].title = content.contact_title;
        if (content.contact_phone)
            data.contacts[0].phones = [{'phone': content.contact_phone, 'type': 'office'}];
        if (content.contact_email)
            data.contacts[0].emails = [{'email': content.contact_email, 'type': 'office'}];
        
        // Convert incoming address_* fields to populate first object in addressses
        if (content.address_1 || content.address_city || content.address_state || content.address_zipcode || content.address_country) {
            data.addresses = [{}];
            if (content.address_label)
                data.addresses[0].label = content.address_label;
            if (content.address_street_1)
                data.addresses[0].address_1 = content.address_street_1;
            if (content.address_street_2)
                data.addresses[0].address_2 = content.address_street_2;
            if (content.address_city)
                data.addresses[0].city = content.address_city;
            if (content.address_state)
                data.addresses[0].state = content.address_state;
            if (content.address_zipcode)
                data.addresses[0].zipcode = content.address_zipcode;
            if (content.address_country)
                data.addresses[0].country = content.address_country;
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
        fields = bundle.action_fields;
        
        content = JSON.parse(bundle.response.content);
        
        if (!content.id)
            return;
        
        if (fields.note) {
            var request = {
              'method': 'POST',
              'url': 'https://app.close.io/api/v1/activity/note/',
              'params': {
              },
              'headers': {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              'auth': [bundle.auth_fields.api_key, ''],
              'data': '{"note": "' + fields.note + '", "lead_id": "' + content.id + '"}'
            };
            z.request(request);
        }
        return;
    },
    new_lead_post_custom_action_fields: function(bundle) {
        content = JSON.parse(bundle.response.content);
        fields = [];
        _.each(content.data, function(field, index) {
            fields.push({"type": "unicode", "key": "custom."+field.name, "label": field.name, "help_text": 'This is a custom field.'});
        });
        return fields;
    },
    task_post_poll: function(bundle) {
        results = JSON.parse(bundle.response.content).data;
        _.each(results, function(result){
            result.lead = z.dehydrate('get_lead_info', {lead_id: result.lead_id});
        });
        return results;
    }
};